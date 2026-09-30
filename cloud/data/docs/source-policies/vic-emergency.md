# VicEmergency feed access review

Reviewed 2026-09-29. **Decision: `review_required`; do not run T065 or scrape the website.**

| Question | Official evidence | Decision |
| --- | --- | --- |
| Website reuse | [VicEmergency Terms of Use](https://emergency.vic.gov.au/about-this-site/terms-of-use) define content to include data, grant a revocable licence to access and use the app/site, and require prior written permission for reproduction, adaptation, or public communication beyond limited statutory copies. | Public viewing does not authorize this product to copy and republish incidents. |
| Developer feed | The [CFA RSS and developer feeds page](https://www.cfa.vic.gov.au/rss-feeds) lists incident XML/JSON URLs, but says developer access to Victorian emergency data is managed by Emergency Management Victoria. | An exposed endpoint is not itself permission for third-party use. Obtain EMV access terms first. |
| RSS alternative | The same CFA page limits RSS to personal, non-commercial use in RSS readers and restricts modification. | Do not substitute the RSS feed for a product integration. |
| Location and timeliness | VicEmergency's terms describe emergency information as incomplete and potentially delayed; icons may indicate a reported origin rather than the affected extent. | If a feed is licensed, keep incident point and affected area separate and show source update time. |

Before implementation, the project owner must obtain the applicable developer feed terms or written permission from Emergency Management Victoria covering automated access, reuse, permitted fields, retention, update frequency, attribution, and public display. Until then, the source remains conditional and is excluded from the initial source count.
