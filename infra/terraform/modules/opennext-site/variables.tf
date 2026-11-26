variable "stage" {
  description = "Deployment stage."
  type        = string
}

variable "account_id" {
  description = "AWS account that owns this stage."
  type        = string
}

variable "region" {
  description = "Region of the application."
  type        = string
  default     = "eu-central-1"
}

variable "permissions_boundary_arn" {
  description = "Customer managed policy that bounds every execution role. Created by bootstrap, never by this module."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/hartolit-(staging|production)-tf-lambda-boundary$", var.permissions_boundary_arn))
    error_message = "permissions_boundary_arn must be this application's Terraform Lambda boundary."
  }
}

variable "public_path_patterns" {
  description = "CloudFront path patterns of the files in public/ (for example logo.png, icons/*)."
  type        = list(string)

  validation {
    condition     = length(var.public_path_patterns) > 0 && length(var.public_path_patterns) <= 15
    error_message = "public_path_patterns must hold 1 to 15 patterns; CloudFront allows 25 behaviors per distribution."
  }

  validation {
    condition     = alltrue([for pattern in var.public_path_patterns : !contains(["*", "/*", "_next/*", "api/*"], pattern) && !startswith(pattern, "/")])
    error_message = "A public path pattern must not capture the application's dynamic routes."
  }
}

variable "environment" {
  description = "Non-secret server variables. Secrets reach the server only through SSM."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for key in keys(var.environment) :
      !can(regex("(?i)(SECRET|PASSWORD|PASSPHRASE|PRIVATE|TOKEN|CREDENTIAL|DATABASE_URL|API_KEY|ACCESS_KEY)", key))
    ])
    error_message = "A secret must not be a Lambda environment variable; store it in SSM."
  }

  validation {
    condition     = alltrue([for value in values(var.environment) : !can(regex("(?i)postgres(ql)?://|AKIA[0-9A-Z]{12,}|-----BEGIN", value))])
    error_message = "An environment value looks like a connection string or a key; store it in SSM."
  }

  validation {
    condition = length(setintersection(keys(var.environment), [
      "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_DEMO_MODE", "HARTOLIT_CLIENT_IP_SOURCE", "HARTOLIT_SECRET_PARAMETERS",
      "CACHE_BUCKET_NAME", "CACHE_BUCKET_KEY_PREFIX", "CACHE_BUCKET_REGION", "CACHE_DYNAMO_TABLE", "REVALIDATION_QUEUE_URL", "REVALIDATION_QUEUE_REGION",
    ])) == 0
    error_message = "This variable is set by the module and cannot be overridden."
  }
}

variable "site_url" {
  description = "Public https:// address of the site. Null uses the CloudFront address."
  type        = string
  default     = null

  validation {
    condition     = var.site_url == null || can(regex("^https://[a-z0-9.-]+$", var.site_url))
    error_message = "site_url must be an https:// origin without a path."
  }
}

variable "log_retention_days" {
  description = "Log retention of the server and ISR functions."
  type        = number
  default     = 7
}

variable "price_class" {
  description = "CloudFront price class."
  type        = string
  default     = "PriceClass_100"
}

variable "force_destroy_assets" {
  description = "Allow deleting a non-empty assets bucket. Staging only."
  type        = bool
  default     = false

  validation {
    condition     = !var.force_destroy_assets || var.stage != "production"
    error_message = "Production assets cannot be force-destroyed."
  }
}

variable "deletion_protection" {
  description = "Protect the ISR table from deletion."
  type        = bool
  default     = true

  validation {
    condition     = var.deletion_protection || var.stage != "production"
    error_message = "The production ISR table must keep deletion protection."
  }
}
