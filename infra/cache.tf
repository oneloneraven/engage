resource "cloudflare_ruleset" "app_cache_rules" {
  zone_id     = data.cloudflare_zone.app.id
  kind        = "zone"
  phase       = "http_request_cache_settings"
  name        = "Cache rules"
  description = "Bypass the API, cache static assets"

  rules = [
    {
      description = "Bypass cache for the API"
      expression  = "starts_with(http.request.uri.path, \"/api/\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
    {
      description = "Cache static assets: 30 days at the edge, 1 year in the browser"
      expression  = "(http.request.uri.path.extension in {\"css\" \"js\" \"png\" \"jpg\" \"jpeg\" \"gif\" \"svg\" \"webp\" \"woff\" \"woff2\" \"ico\" \"map\"})"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 2592000
        }
        browser_ttl = {
          mode    = "override_origin"
          default = 31536000
        }
      }
    }
  ]
}
