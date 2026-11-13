output "app_dnssec_ds_record" {
  description = "DS record to add at the domain registrar once DNSSEC is active."
  value       = cloudflare_zone_dnssec.app.ds
}

output "d1_database_id" {
  description = "Copied into wrangler.jsonc's d1_databases binding."
  value       = cloudflare_d1_database.engage.id
}
