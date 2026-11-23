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

  # The bucket name holds the account number: `terraform init -backend-config=bucket=...`.
  backend "s3" {
    key          = "staging/site/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}

variable "account_id" {
  description = "Staging AWS account. Terraform refuses credentials of any other account."
  type        = string
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

locals {
  public_files = fileset("${path.module}/../../../../../public", "**")
  public_path_patterns = sort(distinct([
    for file in local.public_files :
    length(split("/", file)) > 1 ? "${split("/", file)[0]}/*" : file
  ]))
}

module "site" {
  source = "../../../modules/opennext-site"

  stage                    = "staging"
  account_id               = var.account_id
  permissions_boundary_arn = "arn:aws:iam::${var.account_id}:policy/hartolit-staging-tf-lambda-boundary"
  public_path_patterns     = local.public_path_patterns
  log_retention_days       = 7
  price_class              = "PriceClass_100"
  force_destroy_assets     = true
  deletion_protection      = false

  environment = {
    # One request per Lambda instance; keep each instance's database connections few.
    DATABASE_POOL_MAX            = "3"
    NEXT_PUBLIC_CHAIN_ID         = "97"
    NEXT_PUBLIC_CONTRACT_ADDRESS = ""
    NEXT_TELEMETRY_DISABLED      = "1"
  }
}

output "distribution_id" {
  description = "CloudFront distribution."
  value       = module.site.distribution_id
}

output "distribution_domain_name" {
  description = "CloudFront address of staging."
  value       = module.site.distribution_domain_name
}

output "assets_bucket" {
  description = "Assets bucket."
  value       = module.site.assets_bucket
}

output "function_names" {
  description = "Functions the app deploy updates."
  value       = module.site.function_names
}
