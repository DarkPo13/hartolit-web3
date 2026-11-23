# Run by an administrator from their own shell, never by GitHub. The values are ephemeral and
# write-only: Terraform sends them to SSM and keeps them out of plans and state.
# To rotate, supply the new values and raise `secrets_version`.

terraform {
  required_version = "~> 1.17.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.73.0"
    }
  }

  backend "s3" {
    key          = "staging/secrets/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

variable "account_id" {
  description = "Staging AWS account."
  type        = string
}

variable "database_url" {
  description = "Connection string of the staging database. Set through TF_VAR_database_url."
  type        = string
  ephemeral   = true
  sensitive   = true
  nullable    = false
}

variable "better_auth_secret" {
  description = "Better Auth secret, 32 characters or more. Set through TF_VAR_better_auth_secret."
  type        = string
  ephemeral   = true
  sensitive   = true
  nullable    = false

  validation {
    condition     = length(var.better_auth_secret) >= 32
    error_message = "The Better Auth secret must have at least 32 characters."
  }
}

variable "secrets_version" {
  description = "Raise by one to send new secret values."
  type        = number
  default     = 1
}

provider "aws" {
  region              = "eu-central-1"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = {
      Project   = "hartolit-field-passport"
      Stage     = "staging"
      ManagedBy = "terraform"
    }
  }
}

module "names" {
  source = "../../../modules/naming"

  stage      = "staging"
  account_id = var.account_id
}

resource "aws_ssm_parameter" "database_url" {
  name             = module.names.parameter_names.database_url
  description      = "Hartolit staging database connection"
  type             = "SecureString"
  value_wo         = var.database_url
  value_wo_version = var.secrets_version
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name             = module.names.parameter_names.better_auth_secret
  description      = "Hartolit staging Better Auth secret"
  type             = "SecureString"
  value_wo         = var.better_auth_secret
  value_wo_version = var.secrets_version
}
