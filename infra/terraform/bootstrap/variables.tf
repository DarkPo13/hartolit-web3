variable "stage" {
  description = "Stage of this account."
  type        = string
}

variable "account_id" {
  description = "AWS account of this stage. Terraform refuses credentials of any other account."
  type        = string
}

variable "region" {
  description = "Region of the application and the state bucket."
  type        = string
  default     = "eu-central-1"
}

variable "github_repository" {
  description = "owner/name of the only repository the GitHub roles trust."
  type        = string
  default     = "DarkPo13/hartolit-web3"
}

variable "deploy_environment_protected" {
  description = "True only after the GitHub deploy Environment allows master alone and requires a reviewer."
  type        = bool
  default     = false
}

variable "apply_environment_protected" {
  description = "True only after the GitHub apply Environment allows master alone and requires a reviewer."
  type        = bool
  default     = false
}

variable "production_bootstrap_approved" {
  description = "Must be set deliberately before anything is created in the production account."
  type        = bool
  default     = false
}
