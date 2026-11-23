# Three GitHub roles with separate powers:
# - tf-plan:    reads infrastructure and state; changes nothing but its own state lock.
# - app-deploy: uploads application code and assets; no IAM and no function settings.
# - tf-apply:   changes infrastructure; exists only behind a protected GitHub Environment.
# A push to master can reach the first two. Neither can change IAM.

module "names" {
  source = "../naming"

  stage      = var.stage
  account_id = var.account_id
  region     = var.region
}

locals {
  names             = module.names
  oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/token.actions.githubusercontent.com"
  master_subject    = "repo:${var.github_repository}:ref:refs/heads/master"
  apply_environment = "${var.stage}-terraform-apply"
  apply_subject     = "repo:${var.github_repository}:environment:${local.apply_environment}"

  role_names = {
    plan   = "hartolit-${var.stage}-tf-plan"
    apply  = "hartolit-${var.stage}-tf-apply"
    deploy = "hartolit-${var.stage}-app-deploy"
  }

  state_bucket_arn = "arn:aws:s3:::${local.names.state_bucket_name}"
  state_prefix     = "${var.stage}/site"
  state_key_arn    = "${local.state_bucket_arn}/${local.state_prefix}/terraform.tfstate"

  function_pattern = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.names.prefix}*"
  edge_arn         = "arn:aws:lambda:us-east-1:${var.account_id}:function:${local.names.edge_function_name}"
  edge_arns        = [local.edge_arn, "${local.edge_arn}:*"]
  role_pattern     = "arn:aws:iam::${var.account_id}:role/${local.names.prefix}*"
  log_pattern      = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.names.prefix}*"
  deployed_functions = [
    for name in values(local.names.function_names) :
    "arn:aws:lambda:${var.region}:${var.account_id}:function:${name}"
  ]
  seeder_arn       = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.names.function_names.seeder}"
  distribution_arn = "arn:aws:cloudfront::${var.account_id}:distribution/*"
  site_url_arn     = local.names.parameter_arns.site_url

  who_am_i = {
    Sid      = "WhoAmI"
    Effect   = "Allow"
    Action   = "sts:GetCallerIdentity"
    Resource = "*"
  }

  deny_secret_parameters = [
    {
      Sid      = "DenyReadingOrWritingSecrets"
      Effect   = "Deny"
      Action   = ["ssm:GetParameter*", "ssm:PutParameter", "ssm:DeleteParameter*", "ssm:LabelParameterVersion"]
      Resource = local.names.secret_parameter_arns
    },
    {
      # AWS authorizes this call on the requested path, not on each parameter it returns.
      Sid      = "DenyReadingParametersByPath"
      Effect   = "Deny"
      Action   = "ssm:GetParametersByPath"
      Resource = "*"
    },
  ]

  plan_policy = {
    Version = "2012-10-17"
    Statement = concat([
      local.who_am_i,
      {
        Sid       = "ListOwnState"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = local.state_bucket_arn
        Condition = { StringLike = { "s3:prefix" = "${local.state_prefix}/*" } }
      },
      {
        Sid      = "ReadOwnState"
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = local.state_key_arn
      },
      {
        Sid      = "OwnStateLock"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${local.state_key_arn}.tflock"
      },
      {
        Sid    = "ReadFunctions"
        Effect = "Allow"
        Action = [
          "lambda:GetFunction", "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionConfiguration",
          "lambda:GetFunctionUrlConfig", "lambda:GetPolicy", "lambda:GetRuntimeManagementConfig",
          "lambda:ListTags", "lambda:ListVersionsByFunction",
        ]
        Resource = concat([local.function_pattern], local.edge_arns)
      },
      {
        Sid      = "ReadQueueTrigger"
        Effect   = "Allow"
        Action   = ["lambda:GetEventSourceMapping", "lambda:ListEventSourceMappings"]
        Resource = "*"
      },
      {
        Sid      = "ReadRoles"
        Effect   = "Allow"
        Action   = ["iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"]
        Resource = local.role_pattern
      },
      {
        Sid      = "ReadLogGroups"
        Effect   = "Allow"
        Action   = ["logs:DescribeLogGroups", "logs:ListTagsForResource", "logs:ListTagsLogGroup"]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:*"
      },
      {
        Sid    = "ReadAssetsBucketSettings"
        Effect = "Allow"
        Action = [
          "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketLocation", "s3:GetBucketLogging",
          "s3:GetBucketObjectLockConfiguration", "s3:GetBucketOwnershipControls", "s3:GetBucketPolicy", "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketRequestPayment", "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketWebsite",
          "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket",
        ]
        Resource = local.names.bucket_arn
      },
      {
        Sid      = "ReadQueue"
        Effect   = "Allow"
        Action   = ["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags"]
        Resource = local.names.queue_arn
      },
      {
        Sid      = "ReadTable"
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource"]
        Resource = local.names.table_arn
      },
      {
        Sid    = "ReadCloudFront"
        Effect = "Allow"
        Action = [
          "cloudfront:DescribeFunction", "cloudfront:GetCachePolicy", "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig",
          "cloudfront:GetFunction", "cloudfront:GetOriginAccessControl", "cloudfront:ListTagsForResource",
        ]
        Resource = [
          local.distribution_arn,
          "arn:aws:cloudfront::${var.account_id}:cache-policy/*",
          "arn:aws:cloudfront::${var.account_id}:function/${local.names.prefix}*",
          "arn:aws:cloudfront::${var.account_id}:origin-access-control/*",
        ]
      },
      {
        Sid      = "ReadSiteUrlParameter"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource"]
        Resource = local.site_url_arn
      },
      {
        Sid      = "DescribeParameters"
        Effect   = "Allow"
        Action   = "ssm:DescribeParameters"
        Resource = "*"
      },
    ], local.deny_secret_parameters)
  }

  deploy_policy = {
    Version = "2012-10-17"
    Statement = [
      local.who_am_i,
      {
        Sid      = "UpdateApplicationCode"
        Effect   = "Allow"
        Action   = ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode"]
        Resource = local.deployed_functions
      },
      {
        Sid      = "RunRevalidationSeeder"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = local.seeder_arn
      },
      {
        Sid      = "UploadAssetsAndPageCache"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = ["${local.names.bucket_arn}/_assets/*", "${local.names.bucket_arn}/_cache/*"]
      },
      {
        Sid      = "ListAssets"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.names.bucket_arn
      },
      {
        Sid      = "InvalidateCdn"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
        Resource = local.distribution_arn
      },
      {
        Sid    = "DenyEverythingThatChangesAccess"
        Effect = "Deny"
        Action = [
          "iam:*", "kms:*", "ssm:*", "sts:AssumeRole",
          "lambda:AddPermission", "lambda:CreateFunction", "lambda:CreateFunctionUrlConfig", "lambda:DeleteFunction",
          "lambda:DeleteFunctionUrlConfig", "lambda:PublishLayerVersion", "lambda:RemovePermission",
          "lambda:UpdateFunctionConfiguration", "lambda:UpdateFunctionUrlConfig",
        ]
        Resource = "*"
      },
    ]
  }

  apply_functions_policy = {
    Version = "2012-10-17"
    Statement = [
      local.who_am_i,
      {
        Sid    = "LambdaFunctions"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:DeleteFunctionUrlConfig", "lambda:GetFunction",
          "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionConfiguration", "lambda:GetFunctionUrlConfig", "lambda:GetPolicy",
          "lambda:GetRuntimeManagementConfig", "lambda:ListTags", "lambda:ListVersionsByFunction", "lambda:PublishVersion",
          "lambda:RemovePermission", "lambda:TagResource", "lambda:UntagResource", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        ]
        Resource = concat([local.function_pattern], local.edge_arns)
      },
      {
        Sid       = "LambdaUrlIamAuthOnly"
        Effect    = "Allow"
        Action    = ["lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig"]
        Resource  = local.function_pattern
        Condition = { StringEquals = { "lambda:FunctionUrlAuthType" = "AWS_IAM" } }
      },
      {
        Sid       = "LambdaInvokeOnlyFromCloudFront"
        Effect    = "Allow"
        Action    = "lambda:AddPermission"
        Resource  = local.function_pattern
        Condition = { StringEquals = { "lambda:Principal" = "cloudfront.amazonaws.com" } }
      },
      {
        Sid      = "LambdaEdgeReplication"
        Effect   = "Allow"
        Action   = ["lambda:DisableReplication*", "lambda:EnableReplication*"]
        Resource = local.edge_arns
      },
      {
        Sid       = "QueueTriggerCreate"
        Effect    = "Allow"
        Action    = "lambda:CreateEventSourceMapping"
        Resource  = "*"
        Condition = { ArnLike = { "lambda:FunctionArn" = "arn:aws:lambda:${var.region}:${var.account_id}:function:${local.names.function_names.revalidation}" } }
      },
      {
        Sid      = "QueueTriggerManage"
        Effect   = "Allow"
        Action   = ["lambda:DeleteEventSourceMapping", "lambda:GetEventSourceMapping", "lambda:ListTags", "lambda:TagResource", "lambda:UntagResource", "lambda:UpdateEventSourceMapping"]
        Resource = "arn:aws:lambda:${var.region}:${var.account_id}:event-source-mapping:*"
      },
      {
        Sid      = "QueueTriggerList"
        Effect   = "Allow"
        Action   = "lambda:ListEventSourceMappings"
        Resource = "*"
      },
      {
        Sid      = "FunctionRolesRead"
        Effect   = "Allow"
        Action   = ["iam:DeleteRole", "iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:ListRolePolicies", "iam:TagRole", "iam:UntagRole"]
        Resource = local.role_pattern
      },
      {
        Sid       = "FunctionRolesOnlyInsideBoundary"
        Effect    = "Allow"
        Action    = ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:PutRolePolicy"]
        Resource  = local.role_pattern
        Condition = { StringEquals = { "iam:PermissionsBoundary" = var.lambda_boundary_arn } }
      },
      {
        Sid       = "PassFunctionRolesToLambdaOnly"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = local.role_pattern
        Condition = { StringEquals = { "iam:PassedToService" = ["edgelambda.amazonaws.com", "lambda.amazonaws.com"] } }
      },
      {
        Sid    = "LambdaEdgeServiceLinkedRoles"
        Effect = "Allow"
        Action = "iam:CreateServiceLinkedRole"
        Resource = [
          "arn:aws:iam::${var.account_id}:role/aws-service-role/logger.cloudfront.amazonaws.com/AWSServiceRoleForCloudFrontLogger",
          "arn:aws:iam::${var.account_id}:role/aws-service-role/replicator.lambda.amazonaws.com/AWSServiceRoleForLambdaReplicator",
        ]
        Condition = { StringEquals = { "iam:AWSServiceName" = ["logger.cloudfront.amazonaws.com", "replicator.lambda.amazonaws.com"] } }
      },
    ]
  }

  apply_web_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ListOwnState"
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = local.state_bucket_arn
        Condition = { StringLike = { "s3:prefix" = "${local.state_prefix}/*" } }
      },
      {
        Sid      = "WriteOwnState"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
        Resource = [local.state_key_arn, "${local.state_key_arn}.tflock"]
      },
      {
        Sid      = "LogGroups"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DeleteRetentionPolicy", "logs:ListTagsForResource", "logs:ListTagsLogGroup", "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource"]
        Resource = [local.log_pattern, "${local.log_pattern}:*"]
      },
      {
        Sid      = "LogGroupLookup"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:*"
      },
      {
        Sid    = "AssetsBucket"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:DeleteBucketPolicy", "s3:GetAccelerateConfiguration", "s3:GetBucketAcl", "s3:GetBucketCORS",
          "s3:GetBucketLocation", "s3:GetBucketLogging", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketOwnershipControls", "s3:GetBucketPolicy",
          "s3:GetBucketPublicAccessBlock", "s3:GetBucketRequestPayment", "s3:GetBucketTagging", "s3:GetBucketVersioning", "s3:GetBucketWebsite",
          "s3:GetEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:ListBucket", "s3:ListBucketVersions",
          "s3:PutBucketOwnershipControls", "s3:PutBucketPolicy", "s3:PutBucketPublicAccessBlock", "s3:PutBucketTagging", "s3:PutEncryptionConfiguration",
        ]
        Resource = local.names.bucket_arn
      },
      {
        Sid      = "EmptyStagingBucketOnDestroy"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject", "s3:DeleteObjectVersion"]
        Resource = "${local.names.bucket_arn}/*"
      },
      {
        Sid      = "RevalidationQueue"
        Effect   = "Allow"
        Action   = ["sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:ListQueueTags", "sqs:SetQueueAttributes", "sqs:TagQueue", "sqs:UntagQueue"]
        Resource = local.names.queue_arn
      },
      {
        Sid      = "RevalidationTable"
        Effect   = "Allow"
        Action   = ["dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeContinuousBackups", "dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource", "dynamodb:UpdateContinuousBackups", "dynamodb:UpdateTable"]
        Resource = [local.names.table_arn, "${local.names.table_arn}/index/*"]
      },
      {
        Sid      = "CloudFrontFunction"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateFunction", "cloudfront:DeleteFunction", "cloudfront:DescribeFunction", "cloudfront:GetFunction", "cloudfront:PublishFunction", "cloudfront:UpdateFunction"]
        Resource = "arn:aws:cloudfront::${var.account_id}:function/${local.names.prefix}*"
      },
      {
        Sid      = "CloudFrontDistribution"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateDistribution", "cloudfront:CreateInvalidation", "cloudfront:DeleteDistribution", "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:GetInvalidation", "cloudfront:ListTagsForResource", "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:UpdateDistribution"]
        Resource = local.distribution_arn
      },
      {
        Sid      = "CloudFrontPolicies"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateCachePolicy", "cloudfront:DeleteCachePolicy", "cloudfront:GetCachePolicy", "cloudfront:GetCachePolicyConfig", "cloudfront:UpdateCachePolicy"]
        Resource = "arn:aws:cloudfront::${var.account_id}:cache-policy/*"
      },
      {
        Sid      = "CloudFrontOriginAccess"
        Effect   = "Allow"
        Action   = ["cloudfront:CreateOriginAccessControl", "cloudfront:DeleteOriginAccessControl", "cloudfront:GetOriginAccessControl", "cloudfront:GetOriginAccessControlConfig", "cloudfront:UpdateOriginAccessControl"]
        Resource = "arn:aws:cloudfront::${var.account_id}:origin-access-control/*"
      },
      {
        Sid      = "SiteUrlParameter"
        Effect   = "Allow"
        Action   = ["ssm:AddTagsToResource", "ssm:DeleteParameter", "ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource", "ssm:PutParameter", "ssm:RemoveTagsFromResource"]
        Resource = local.site_url_arn
      },
      {
        Sid      = "DescribeParameters"
        Effect   = "Allow"
        Action   = "ssm:DescribeParameters"
        Resource = "*"
      },
    ]
  }

  apply_guardrails_policy = {
    Version = "2012-10-17"
    Statement = concat([
      {
        Sid       = "DenyOtherRegions"
        Effect    = "Deny"
        Action    = "*"
        Resource  = "*"
        Condition = { StringNotEquals = { "aws:RequestedRegion" = ["eu-central-1", "us-east-1"] } }
      },
      {
        Sid    = "DenyTouchingDeployIdentities"
        Effect = "Deny"
        Action = "iam:*"
        Resource = [
          "arn:aws:iam::${var.account_id}:role/hartolit-github-*",
          "arn:aws:iam::${var.account_id}:role/hartolit-${var.stage}-*",
          "arn:aws:iam::${var.account_id}:policy/hartolit-${var.stage}-*",
          local.oidc_provider_arn,
        ]
      },
      {
        Sid      = "DenyRemovingAnyBoundary"
        Effect   = "Deny"
        Action   = "iam:DeleteRolePermissionsBoundary"
        Resource = "*"
      },
      {
        Sid       = "DenyRolePowersOutsideBoundary"
        Effect    = "Deny"
        Action    = ["iam:AttachRolePolicy", "iam:CreateRole", "iam:PutRolePermissionsBoundary", "iam:PutRolePolicy"]
        Resource  = "*"
        Condition = { StringNotEquals = { "iam:PermissionsBoundary" = var.lambda_boundary_arn } }
      },
      {
        Sid    = "DenyOtherIdentityEscalation"
        Effect = "Deny"
        Action = [
          "iam:AddClientIDToOpenIDConnectProvider", "iam:AddUserToGroup", "iam:AttachGroupPolicy", "iam:AttachUserPolicy", "iam:CreateAccessKey",
          "iam:CreateLoginProfile", "iam:CreateOpenIDConnectProvider", "iam:CreatePolicy", "iam:CreatePolicyVersion", "iam:CreateUser",
          "iam:DeletePolicy", "iam:DeletePolicyVersion", "iam:PutGroupPolicy", "iam:PutUserPolicy", "iam:SetDefaultPolicyVersion",
          "iam:UpdateAssumeRolePolicy", "iam:UpdateLoginProfile", "iam:UpdateOpenIDConnectProviderThumbprint", "sts:AssumeRole",
        ]
        Resource = "*"
      },
      {
        Sid       = "DenyPublicFunctionUrls"
        Effect    = "Deny"
        Action    = ["lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig"]
        Resource  = "*"
        Condition = { StringNotEquals = { "lambda:FunctionUrlAuthType" = "AWS_IAM" } }
      },
      {
        Sid       = "DenyInvokeGrantsToOthers"
        Effect    = "Deny"
        Action    = "lambda:AddPermission"
        Resource  = "*"
        Condition = { StringNotEquals = { "lambda:Principal" = "cloudfront.amazonaws.com" } }
      },
    ], local.deny_secret_parameters)
  }

  apply_policies = {
    functions  = jsonencode(local.apply_functions_policy)
    web        = jsonencode(local.apply_web_policy)
    guardrails = jsonencode(local.apply_guardrails_policy)
  }

  all_subjects = {
    plan   = local.master_subject
    deploy = local.master_subject
    apply  = local.apply_subject
  }
  subjects = {
    for key, subject in local.all_subjects : key => subject
    if key != "apply" || var.apply_environment_protected
  }

  trust_policies = {
    for key, subject in local.subjects : key => jsonencode({
      Version = "2012-10-17"
      Statement = [{
        Effect    = "Allow"
        Action    = "sts:AssumeRoleWithWebIdentity"
        Principal = { Federated = local.oidc_provider_arn }
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
            "token.actions.githubusercontent.com:sub" = subject
          }
        }
      }]
    })
  }
}

resource "aws_iam_role" "github" {
  for_each = local.trust_policies

  name                 = local.role_names[each.key]
  description          = "GitHub Actions ${each.key} role for Hartolit ${var.stage}"
  assume_role_policy   = each.value
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "plan" {
  name   = "read-only"
  role   = aws_iam_role.github["plan"].name
  policy = jsonencode(local.plan_policy)
}

resource "aws_iam_role_policy" "deploy" {
  name   = "application-only"
  role   = aws_iam_role.github["deploy"].name
  policy = jsonencode(local.deploy_policy)
}

resource "aws_iam_policy" "apply" {
  for_each = { for key, policy in local.apply_policies : key => policy if var.apply_environment_protected }

  name   = "hartolit-${var.stage}-tf-apply-${each.key}"
  policy = each.value
}

resource "aws_iam_role_policy_attachment" "apply" {
  for_each = aws_iam_policy.apply

  role       = aws_iam_role.github["apply"].name
  policy_arn = each.value.arn
}
