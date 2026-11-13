# Engage answers on two hosts and never the apex, which carries the Proton mail records.
resource "cloudflare_dns_record" "app_hosts" {
  for_each = toset(["engage", "in"])
  zone_id  = data.cloudflare_zone.app.id
  name     = "${each.key}.${var.app_zone_name}"
  type     = "A"
  content  = "192.0.2.1"
  ttl      = 1
  proxied  = true
  comment  = "Placeholder so the Worker route answers on this hostname; traffic never reaches this IP."

  lifecycle {
    prevent_destroy = true
  }
}

locals {
  cloudflare_cas = ["letsencrypt.org", "pki.goog", "ssl.com", "sectigo.com"]
  caa_records = merge(
    { for ca in local.cloudflare_cas : "issue-${ca}" => { tag = "issue", value = ca } },
    { for ca in local.cloudflare_cas : "issuewild-${ca}" => { tag = "issuewild", value = ca } },
  )
}

resource "cloudflare_dns_record" "app_caa" {
  for_each = local.caa_records
  zone_id  = data.cloudflare_zone.app.id
  name     = var.app_zone_name
  type     = "CAA"
  ttl      = 3600
  data = {
    flags = 0
    tag   = each.value.tag
    value = each.value.value
  }
}
