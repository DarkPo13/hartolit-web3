# One Next.js site built by OpenNext 4.1.16: CloudFront in front of private Lambda function
# URLs and a private S3 bucket. Nothing here is billed while idle: no VPC, NAT, load
# balancer, provisioned concurrency, warmer, KMS key or WAF.
#
# Terraform owns the infrastructure and a placeholder package. The application package is
# uploaded later by the app-deploy role, which has no IAM rights, so `code` is ignored below.

module "names" {
  source = "../naming"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

locals {
  names = module.names

  # Set by the module and merged last: no caller can turn these off.
  server_fixed_environment = {
    HARTOLIT_CLIENT_IP_SOURCE = "cloudfront"
    NEXT_PUBLIC_DEMO_MODE     = "false"
    CACHE_BUCKET_NAME         = local.names.bucket_name
    CACHE_BUCKET_KEY_PREFIX   = "_cache"
    CACHE_BUCKET_REGION       = var.region
    REVALIDATION_QUEUE_URL    = aws_sqs_queue.revalidation.url
    REVALIDATION_QUEUE_REGION = var.region
    CACHE_DYNAMO_TABLE        = local.names.table_name
    # Read by hartolit-entry.mjs before the application loads.
    HARTOLIT_SECRET_PARAMETERS = jsonencode({
      DATABASE_URL        = local.names.parameter_names.database_url
      BETTER_AUTH_SECRET  = local.names.parameter_names.better_auth_secret
      BETTER_AUTH_URL     = local.names.parameter_names.site_url
      NEXT_PUBLIC_APP_URL = local.names.parameter_names.site_url
    })
  }

  functions = {
    server = {
      handler      = "hartolit-entry.handler"
      memory       = 1024
      timeout      = 60
      architecture = "arm64"
      retention    = var.log_retention_days
      environment  = merge(var.environment, local.server_fixed_environment)
    }
    image = {
      handler      = "index.handler"
      memory       = 512
      timeout      = 25
      architecture = "arm64"
      retention    = 3
      environment = {
        BUCKET_NAME       = local.names.bucket_name
        BUCKET_KEY_PREFIX = "_assets"
      }
    }
    revalidation = {
      handler      = "index.handler"
      memory       = 1024
      timeout      = 30
      architecture = "x86_64"
      retention    = var.log_retention_days
      environment  = {}
    }
    seeder = {
      handler      = "index.handler"
      memory       = 128
      timeout      = 900
      architecture = "x86_64"
      retention    = var.log_retention_days
      environment = {
        CACHE_DYNAMO_TABLE = local.names.table_name
      }
    }
  }

  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  log_statements = {
    for key, arn in local.names.function_log_group_arns : key => {
      Sid      = "OwnLogs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${arn}:*"
    }
  }

  function_statements = {
    server = [
      local.log_statements.server,
      {
        Sid      = "PageCacheObjects"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.names.bucket_arn}/_cache/*"
      },
      {
        Sid      = "PageCacheList"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.names.bucket_arn
      },
      {
        Sid      = "RevalidationQueueSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
        Resource = local.names.queue_arn
      },
      {
        Sid    = "RevalidationTable"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem", "dynamodb:ConditionCheckItem", "dynamodb:DeleteItem",
          "dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan", "dynamodb:UpdateItem",
        ]
        Resource = [local.names.table_arn, "${local.names.table_arn}/index/*"]
      },
      {
        Sid      = "ReadOwnParameters"
        Effect   = "Allow"
        Action   = "ssm:GetParameters"
        Resource = values(local.names.parameter_arns)
      },
      {
        Sid      = "DecryptOwnSecretsThroughSsm"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "arn:aws:kms:${var.region}:${var.account_id}:key/*"
        Condition = {
          StringEquals = {
            "kms:ViaService"                      = "ssm.${var.region}.amazonaws.com"
            "kms:EncryptionContext:PARAMETER_ARN" = local.names.secret_parameter_arns
          }
        }
      },
    ]
    image = [
      local.log_statements.image,
      {
        Sid      = "ReadPublicAssets"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "${local.names.bucket_arn}/_assets/*"
      },
    ]
    revalidation = [
      local.log_statements.revalidation,
      {
        Sid      = "RevalidationQueueConsume"
        Effect   = "Allow"
        Action   = ["sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ReceiveMessage"]
        Resource = local.names.queue_arn
      },
    ]
    seeder = [
      local.log_statements.seeder,
      {
        Sid      = "SeedRevalidationTable"
        Effect   = "Allow"
        Action   = ["dynamodb:BatchWriteItem", "dynamodb:PutItem", "dynamodb:DescribeTable"]
        Resource = local.names.table_arn
      },
    ]
  }
}

# Answers 503 until the first application deploy, and fails queue events so none is lost.
data "archive_file" "placeholder" {
  type             = "zip"
  output_path      = "${path.root}/.build/${var.stage}-placeholder.zip"
  output_file_mode = "0644"

  source {
    content  = file("${path.module}/functions/placeholder.mjs")
    filename = "index.mjs"
  }

  source {
    content  = file("${path.module}/functions/placeholder.mjs")
    filename = "hartolit-entry.mjs"
  }
}

resource "aws_cloudwatch_log_group" "function" {
  for_each = local.functions

  name              = "/aws/lambda/${local.names.function_names[each.key]}"
  retention_in_days = each.value.retention
}

resource "aws_iam_role" "function" {
  for_each = local.functions

  name                 = local.names.role_names[each.key]
  assume_role_policy   = local.lambda_assume_role_policy
  permissions_boundary = var.permissions_boundary_arn
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions

  name = "least-privilege"
  role = aws_iam_role.function[each.key].name
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.function_statements[each.key]
  })
}

resource "aws_lambda_function" "this" {
  for_each = local.functions

  function_name    = local.names.function_names[each.key]
  description      = "Hartolit ${var.stage} ${each.key}"
  role             = aws_iam_role.function[each.key].arn
  runtime          = "nodejs24.x"
  handler          = each.value.handler
  architectures    = [each.value.architecture]
  memory_size      = each.value.memory
  timeout          = each.value.timeout
  publish          = false
  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function[each.key].name
  }

  dynamic "environment" {
    for_each = length(each.value.environment) > 0 ? [each.value.environment] : []

    content {
      variables = environment.value
    }
  }

  lifecycle {
    # The app-deploy role uploads the real package.
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_iam_role_policy.function]
}

# IAM-only URLs: AWS refuses any call that CloudFront did not sign.
resource "aws_lambda_function_url" "server" {
  function_name      = aws_lambda_function.this["server"].function_name
  authorization_type = "AWS_IAM"
}

resource "aws_lambda_function_url" "image" {
  function_name      = aws_lambda_function.this["image"].function_name
  authorization_type = "AWS_IAM"
}

# AWS requires both permissions for CloudFront OAC, each limited to this distribution.
resource "aws_lambda_permission" "cloudfront_url" {
  for_each = toset(["server", "image"])

  statement_id  = "CloudFrontInvokeFunctionUrl"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.this[each.key].function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = aws_cloudfront_distribution.this.arn
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  for_each = toset(["server", "image"])

  statement_id             = "CloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.this[each.key].function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.this.arn
  invoked_via_function_url = true
}

resource "aws_lambda_event_source_mapping" "revalidation" {
  event_source_arn = aws_sqs_queue.revalidation.arn
  function_name    = aws_lambda_function.this["revalidation"].arn
  batch_size       = 5
}

# Not a secret. Kept in SSM because the distribution address exists only after the function:
# putting it in the function's environment would be a dependency cycle.
resource "aws_ssm_parameter" "site_url" {
  name  = local.names.parameter_names.site_url
  type  = "String"
  value = coalesce(var.site_url, "https://${aws_cloudfront_distribution.this.domain_name}")
}
