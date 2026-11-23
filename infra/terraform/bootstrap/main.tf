# Run by an account administrator, never by GitHub: the state bucket, the Lambda boundary and
# the GitHub roles. Keeping them here means no CI role can rewrite its own limits.
# The existing hand-made SST policies and the OIDC provider are not managed or changed.

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "hartolit-field-passport"
      Stage     = var.stage
      ManagedBy = "terraform-bootstrap"
    }
  }
}

module "names" {
  source = "../modules/naming"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

locals {
  names        = module.names
  boundary_arn = "arn:aws:iam::${var.account_id}:policy/${local.names.lambda_boundary_name}"

  # The most any execution role can do, whatever its own policy says.
  lambda_boundary = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "FunctionLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [for arn in values(local.names.function_log_group_arns) : "${arn}:*"]
      },
      {
        Sid      = "EdgeLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = [local.names.edge_log_group_arn, "${local.names.edge_log_group_arn}:*"]
      },
      {
        Sid      = "ReadAssetsAndPageCache"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = ["${local.names.bucket_arn}/_assets/*", "${local.names.bucket_arn}/_cache/*"]
      },
      {
        Sid      = "WritePageCache"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:PutObject"]
        Resource = "${local.names.bucket_arn}/_cache/*"
      },
      {
        Sid      = "ListBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.names.bucket_arn
      },
      {
        Sid      = "RevalidationQueue"
        Effect   = "Allow"
        Action   = ["sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ReceiveMessage", "sqs:SendMessage"]
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
  }
}

resource "terraform_data" "production_guard" {
  lifecycle {
    precondition {
      condition     = var.stage != "production" || var.production_bootstrap_approved
      error_message = "Production bootstrap is not approved."
    }
  }
}

resource "aws_s3_bucket" "state" {
  bucket = local.names.state_bucket_name

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [terraform_data.production_guard]
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.state]
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [local.names.state_bucket_arn, "${local.names.state_bucket_arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.state]
}

resource "aws_iam_policy" "lambda_boundary" {
  name        = local.names.lambda_boundary_name
  description = "Upper limit of every Hartolit ${var.stage} execution role created by Terraform"
  policy      = jsonencode(local.lambda_boundary)

  depends_on = [terraform_data.production_guard]
}

module "github_roles" {
  source = "../modules/github-oidc-roles"

  stage                       = var.stage
  account_id                  = var.account_id
  region                      = var.region
  github_repository           = var.github_repository
  lambda_boundary_arn         = local.boundary_arn
  apply_environment_protected = var.apply_environment_protected

  depends_on = [aws_iam_policy.lambda_boundary]
}
