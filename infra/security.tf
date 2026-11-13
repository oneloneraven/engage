resource "cloudflare_zone_setting" "app_min_tls_version" {
  zone_id    = data.cloudflare_zone.app.id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "app_always_use_https" {
  zone_id    = data.cloudflare_zone.app.id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "app_hsts" {
  zone_id    = data.cloudflare_zone.app.id
  setting_id = "security_header"
  value = {
    strict_transport_security = {
      enabled            = true
      max_age            = 31536000
      include_subdomains = true
      nosniff            = true
      preload            = false
    }
  }
}

resource "cloudflare_zone_dnssec" "app" {
  zone_id = data.cloudflare_zone.app.id
  status  = "active"
}

resource "cloudflare_ruleset" "security_headers" {
  zone_id     = data.cloudflare_zone.app.id
  kind        = "zone"
  phase       = "http_response_headers_transform"
  name        = "Security headers"
  description = "Framing, referrer, permissions and opener policy on every response"

  rules = [
    {
      description = "Security headers"
      expression  = "true"
      action      = "rewrite"
      action_parameters = {
        headers = {
          "X-Frame-Options"            = { operation = "set", value = "DENY" }
          "Referrer-Policy"            = { operation = "set", value = "strict-origin-when-cross-origin" }
          "Permissions-Policy"         = { operation = "set", value = "camera=(), microphone=(), geolocation=(), payment=(), usb=()" }
          "Cross-Origin-Opener-Policy" = { operation = "set", value = "same-origin" }
        }
      }
    }
  ]
}
