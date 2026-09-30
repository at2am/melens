# Victoria Police news access review

Reviewed 2026-09-29. **Decision: `review_required`; do not run T044 or ingest article bodies.**

| Question | Official evidence | Decision |
| --- | --- | --- |
| Public news entry | [Victoria Police news](https://www.police.vic.gov.au/news) publishes breaking news and public notices. | Human-readable discovery exists, but this is not a documented reuse API. |
| Email distribution | [Breaking news subscription](https://www.police.vic.gov.au/news-article-subscription) states that its media release email service is for accredited media and journalists. | Do not use the email subscription as an application feed. |
| Reuse rights | The site's [disclaimer and copyright page](https://www.police.vic.gov.au/disclaimer) identifies Crown copyright and discusses the protected police crest, but does not grant an explicit licence for automated collection, storage, adaptation, or public redistribution of news text. | Do not infer an open licence from public web access or a general Victorian Government policy. |
| Accuracy | The same disclaimer says information is assessed at publication and may become outdated. | If a licensed feed is obtained later, preserve publication/update time and corrections. |

Permission, allowed fields, storage duration, polling frequency, attribution, and access method require written confirmation or a source-specific published licence. A future connector may store only the fields that confirmation permits, plus the original link. It must use broad reported areas unless incident-site evidence is explicit. This review neither treats a public URL as permission to scrape nor treats a journalist-only subscription as an API.
