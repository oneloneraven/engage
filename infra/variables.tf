variable "cloudflare_account_id" {
  description = "Cloudflare account that owns this project's resources."
  type        = string
}

variable "app_zone_name" {
  description = "The zone the app is served from."
  type        = string
  default     = "oneloneraven.com"
}

variable "owner_email" {
  description = "The one email Access lets through to the admin host. Supplied by the OWNER_EMAIL Actions secret, never committed."
  type        = string
  sensitive   = true
}
