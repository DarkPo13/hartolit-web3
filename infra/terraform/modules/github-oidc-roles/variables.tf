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

variable "github_repository" {
  description = "owner/name of the only repository these roles trust."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must be an exact owner/name, without wildcards."
  }
}

variable "lambda_boundary_arn" {
  description = "Boundary the apply role must put on every role it creates."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/hartolit-(staging|production)-tf-lambda-boundary$", var.lambda_boundary_arn))
    error_message = "lambda_boundary_arn must be this application's Terraform Lambda boundary."
  }
}

variable "apply_environment_protected" {
  description = <<-EOT
    Set to true only after the GitHub Environment `<stage>-terraform-apply` exists, allows
    only the master branch and requires a reviewer. GitHub creates an unknown environment
    without any protection, so until then the apply role is not created at all.
  EOT
  type        = bool
  default     = false
}
