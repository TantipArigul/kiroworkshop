# AWS dev environment (deployment.md — Add-on AWS Dev Environment).
# Backend bucket and KMS key come from infra/bootstrap: terraform init -backend-config=backend.hcl

terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.69.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }

  backend "s3" {
    key          = "tan/dev/portal.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  default_tags = {
    Project     = "${var.prefix}-smart-checkup-portal"
    Environment = var.environment
    Owner       = var.owner
    ManagedBy   = "Terraform"
    Repository  = var.github_repository
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.default_tags
  }
}

# CloudFront-scoped WAF and its logs must live in us-east-1.
provider "aws" {
  alias               = "us_east_1"
  region              = "us-east-1"
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.default_tags
  }
}
