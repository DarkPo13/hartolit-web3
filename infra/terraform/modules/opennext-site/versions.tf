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
}
