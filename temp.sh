(
  unsetopt XTRACE
  MELENS_PROJECT_ID="melens-510012"

  read -r -s 'MELENS_TV_KEY?粘贴 Transport Victoria API Key，然后回车：'
  printf '\n'
  [[ -n "$MELENS_TV_KEY" ]] || exit 1
  printf '%s' "$MELENS_TV_KEY" |
    gcloud secrets versions add transport_victoria_key_id \
      --project="$MELENS_PROJECT_ID" \
      --data-file=- || exit 1
  unset MELENS_TV_KEY

  read -r -s 'MELENS_TM_KEY?粘贴 Ticketmaster API Key，然后回车：'
  printf '\n'
  [[ -n "$MELENS_TM_KEY" ]] || exit 1
  printf '%s' "$MELENS_TM_KEY" |
    gcloud secrets versions add ticketmaster_discovery_api_key \
      --project="$MELENS_PROJECT_ID" \
      --data-file=- || exit 1
  unset MELENS_TM_KEY
)
