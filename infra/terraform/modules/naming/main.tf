# The one place that names this application's AWS resources. The site module, the Lambda
# boundary and the GitHub roles all read these values, so a policy cannot drift from the
# resource it protects. This module creates nothing.

terraform {
  required_version = "~> 1.17.2"
}

variable "stage" {
  description = "Deployment stage."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.stage)
    error_message = "stage must be staging or production."
  }
}

variable "account_id" {
  description = "AWS account that owns this stage."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be 12 digits."
  }
}

variable "region" {
  description = "Region of the application."
  type        = string
  default     = "eu-central-1"

  validation {
    condition     = var.region == "eu-central-1"
    error_message = "The application runs only in eu-central-1."
  }
}

locals {
  prefix = "hartolit-field-passport-${var.stage}-Web"

  function_names = {
    server       = "${local.prefix}Server"
    image        = "${local.prefix}Image"
    revalidation = "${local.prefix}RevalidationSubscriber"
    seeder       = "${local.prefix}RevalidationSeeder"
  }
  edge_function_name = "${local.prefix}EdgeFn-signer"

  role_names = merge(
    { for key, name in local.function_names : key => "${name}Role" },
    { edge = "${local.prefix}EdgeFnRole" },
  )

  bucket_name = "hartolit-field-passport-${var.stage}-webassetsbucket-${var.account_id}"
  queue_name  = "${local.prefix}RevalidationEventsQueue-isr.fifo"
  table_name  = "${local.prefix}RevalidationTable-isr"

  parameter_names = {
    database_url       = "/hartolit/${var.stage}/database-url"
    better_auth_secret = "/hartolit/${var.stage}/better-auth-secret"
    site_url           = "/hartolit/${var.stage}/site-url"
  }
  parameter_arns = {
    for key, name in local.parameter_names :
    key => "arn:aws:ssm:${var.region}:${var.account_id}:parameter${name}"
  }
}

output "prefix" {
  description = "Prefix of every function, role, queue and table name."
  value       = local.prefix
}

output "function_names" {
  description = "Regional Lambda function names."
  value       = local.function_names
}

output "edge_function_name" {
  description = "Lambda@Edge signer name (us-east-1)."
  value       = local.edge_function_name
}

output "role_names" {
  description = "Execution role names."
  value       = local.role_names
}

output "state_bucket_name" {
  description = "Terraform state bucket of this stage's account."
  value       = "hartolit-terraform-state-${var.stage}-${var.account_id}"
}

output "state_bucket_arn" {
  description = "Terraform state bucket ARN."
  value       = "arn:aws:s3:::hartolit-terraform-state-${var.stage}-${var.account_id}"
}

output "lambda_boundary_name" {
  description = "Permissions boundary of every execution role."
  value       = "hartolit-${var.stage}-tf-lambda-boundary"
}

output "bucket_name" {
  description = "Assets and page cache bucket."
  value       = local.bucket_name
}

output "bucket_arn" {
  description = "Assets and page cache bucket ARN."
  value       = "arn:aws:s3:::${local.bucket_name}"
}

output "queue_name" {
  description = "ISR revalidation FIFO queue."
  value       = local.queue_name
}

output "queue_arn" {
  description = "ISR revalidation queue ARN."
  value       = "arn:aws:sqs:${var.region}:${var.account_id}:${local.queue_name}"
}

output "table_name" {
  description = "ISR tag table."
  value       = local.table_name
}

output "table_arn" {
  description = "ISR tag table ARN."
  value       = "arn:aws:dynamodb:${var.region}:${var.account_id}:table/${local.table_name}"
}

output "parameter_names" {
  description = "SSM parameter names."
  value       = local.parameter_names
}

output "parameter_arns" {
  description = "SSM parameter ARNs."
  value       = local.parameter_arns
}

output "secret_parameter_arns" {
  description = "SSM parameters that hold secrets (the site URL is not one)."
  value       = [local.parameter_arns.database_url, local.parameter_arns.better_auth_secret]
}

output "function_log_group_arns" {
  description = "Log group ARNs of the regional functions."
  value = {
    for key, name in local.function_names :
    key => "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${name}"
  }
}

output "edge_log_group_arn" {
  description = "Log group ARN pattern of the signer in every edge region."
  value       = "arn:aws:logs:*:${var.account_id}:log-group:/aws/lambda/us-east-1.${local.edge_function_name}"
}
