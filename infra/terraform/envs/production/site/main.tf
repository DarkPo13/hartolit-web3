# Prepared, not approved. The production account does not exist yet and the database decision
# (Aurora and its network access) is open, so every plan stops at the guard below.

terraform {
  required_version = "~> 1.17.2"

  required_providers {
    archive = {
      source  = "hashicorp/archive"
      version = "= 2.8.1"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.73.0"
    }
  }

  backend "s3" {
    key          = "production/site/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

variable "account_id" {
  description = "Production AWS account, separate from staging."
  type        = string
}

variable "production_apply_approved" {
  description = "Set only after production is approved: its own account, a second reviewer and a database decision."
  type        = bool
  default     = false
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

locals {
  public_files = fileset("${path.module}/../../../../../public", "**")
  public_path_patterns = sort(distinct([
    for file in local.public_files :
    length(split("/", file)) > 1 ? "${split("/", file)[0]}/*" : file
  ]))
}

module "site" {
  source = "../../../modules/opennext-site"

  stage                    = "production"
  account_id               = var.account_id
  permissions_boundary_arn = "arn:aws:iam::${var.account_id}:policy/hartolit-production-tf-lambda-boundary"
  public_path_patterns     = local.public_path_patterns
  log_retention_days       = 30
  price_class              = "PriceClass_100"
  force_destroy_assets     = false
  deletion_protection      = true

  environment = {
    DATABASE_POOL_MAX       = "3"
    NEXT_TELEMETRY_DISABLED = "1"
  }

  depends_on = [terraform_data.production_guard]
}

output "distribution_domain_name" {
  description = "CloudFront address of production."
  value       = module.site.distribution_domain_name
}
