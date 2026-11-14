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

variable "access_login_method_id" {
  description = "The Access login method for signing in with the Cloudflare account, which carries the account's MFA. Supplied by the ACCESS_LOGIN_METHOD_ID repository variable, so this stack never reads account-wide Zero Trust settings."
  type        = string
}
