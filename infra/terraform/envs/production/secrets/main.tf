# Prepared, not approved: see ../site/main.tf. Values are ephemeral and write-only.

terraform {
  required_version = "~> 1.17.2"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.73.0"
    }
  }

  backend "s3" {
    key          = "production/secrets/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

variable "account_id" {
  description = "Production AWS account."
  type        = string
}

variable "production_apply_approved" {
  description = "Set only after production is approved."
  type        = bool
  default     = false
}

variable "database_url" {
  description = "Connection string of the production database. Set through TF_VAR_database_url."
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
      Stage     = "production"
      ManagedBy = "terraform"
    }
  }
}

resource "terraform_data" "production_guard" {
  lifecycle {
    precondition {
      condition     = var.production_apply_approved
      error_message = "Production is not approved: it needs its own account, a second reviewer and a database decision."
    }
  }
}

module "names" {
  source = "../../../modules/naming"

  stage      = "production"
  account_id = var.account_id
}

resource "aws_ssm_parameter" "database_url" {
  name             = module.names.parameter_names.database_url
  description      = "Hartolit production database connection"
  type             = "SecureString"
  value_wo         = var.database_url
  value_wo_version = var.secrets_version

  depends_on = [terraform_data.production_guard]
}

resource "aws_ssm_parameter" "better_auth_secret" {
  name             = module.names.parameter_names.better_auth_secret
  description      = "Hartolit production Better Auth secret"
  type             = "SecureString"
  value_wo         = var.better_auth_secret
  value_wo_version = var.secrets_version

  depends_on = [terraform_data.production_guard]
}
