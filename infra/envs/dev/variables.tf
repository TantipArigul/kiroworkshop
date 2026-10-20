variable "aws_account_id" {
  description = "The only account this stack may change (set in terraform.tfvars, not committed)."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
}

variable "region" {
  type    = string
  default = "ap-southeast-2"
}

variable "prefix" {
  description = "Resource name prefix."
  type        = string
  default     = "tan"

  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.prefix))
    error_message = "prefix must be 2-10 lowercase letters/digits starting with a letter."
  }
}

variable "environment" {
  type    = string
  default = "dev"

  validation {
    condition     = var.environment == "dev"
    error_message = "This stack is the AWS dev environment only (deployment.md)."
  }
}

variable "owner" {
  type    = string
  default = "tan"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "private_subnet_cidr" {
  type    = string
  default = "10.40.1.0/24"
}

variable "availability_zone" {
  type    = string
  default = "ap-southeast-2a"
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "root_volume_size_gb" {
  type    = number
  default = 20
}

variable "data_volume_size_gb" {
  type    = number
  default = 20
}

variable "snapshot_retention_count" {
  description = "Daily data-volume snapshots kept (matches the 7-day job retention)."
  type        = number
  default     = 7
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "session_secret_version" {
  description = "Increase by 1 to rotate SESSION_SECRET (every 90 days or on suspicion), then redeploy."
  type        = number
  default     = 1
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes per client IP before WAF blocks."
  type        = number
  default     = 1000
}

variable "monthly_budget_usd" {
  type    = number
  default = 150
}

variable "github_repository" {
  type    = string
  default = "TantipArigul/kiroworkshop"
}

# Repositories created after 2026-07-15 receive OIDC `sub` claims with owner/repository IDs.
variable "github_owner_id" {
  type    = string
  default = "12658611"
}

variable "github_repository_id" {
  type    = string
  default = "1399479711"
}

variable "github_deploy_branch" {
  type    = string
  default = "main"
}

variable "app_settings" {
  description = "Non-secret runtime settings (from .env.production.example); SESSION_SECRET and ALLOWED_ORIGINS are added by the stack."
  type        = map(string)
  default = {
    NODE_ENV                       = "production"
    PORT                           = "3000"
    DATABASE_URL                   = "file:/var/lib/portal-private/portal.db"
    STORAGE_ROOT                   = "/var/lib/portal-private"
    LOG_LEVEL                      = "info"
    SHUTDOWN_TIMEOUT_MS            = "30000"
    PAGE_SIZE_DEFAULT              = "20"
    PAGE_SIZE_MAX                  = "100"
    LOGIN_RATE_LIMIT_MAX           = "5"
    AUTH_RATE_LIMIT_MAX            = "120"
    SUBMIT_RATE_LIMIT_MAX          = "10"
    SESSION_IDLE_TIMEOUT_MINUTES   = "30"
    SESSION_ABSOLUTE_TIMEOUT_HOURS = "8"
    LOGIN_LOCKOUT_THRESHOLD        = "5"
    LOGIN_LOCKOUT_WINDOW_MINUTES   = "15"
    LOGIN_LOCKOUT_DURATION_MINUTES = "15"
    AUDIT_RETENTION_DAYS           = "90"
    EXECUTOR_ENABLED               = "true"
    EXECUTOR_POLL_INTERVAL_MS      = "2000"
    EXECUTOR_QUEUED_DELAY_MS       = "3000"
    EXECUTOR_RUNNING_DELAY_MS      = "5000"
    JOB_RETENTION_DAYS             = "7"
    RETENTION_SWEEP_INTERVAL_MS    = "3600000"
    NEXTFLOW_ENABLED               = "false"
  }

  validation {
    condition     = !contains(keys(var.app_settings), "SESSION_SECRET")
    error_message = "SESSION_SECRET is managed in Secrets Manager, never in app_settings."
  }
}
