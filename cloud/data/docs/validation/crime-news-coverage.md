# Melbourne crime news coverage gate

Review date: 2026-09-29. Window for the required 30-day check: 2026-08-30 to 2026-09-29 UTC.

**Outcome: not verified. FR-002 crime news coverage and SC-001 remain unmet.** Do not count Victoria Police as an admitted source or treat CSA quarterly LGA totals as individual crime news.

The implemented GDELT GKG connector successfully parsed one complete 15-minute archive in a live smoke check, with zero Victoria mention candidates in that interval. One interval cannot establish a 30-day minimum. A broader [GDELT DOC API](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) search for Melbourne and crime terms was attempted as a discovery aid; the endpoint timed out in this execution environment, so no article list was obtained. Even a DOC search result would require verification against the GKG connector's actual admitted records, distinct article URLs, publication dates, Melbourne occurrence evidence, and reuse rights.

The release gate requires, within the last 30 days, at least five distinct qualifying Melbourne crime reports on at least two publication dates, with source URLs and reviewer-confirmed geographic evidence. Those numerator and date counts are currently **unknown**, not zero. Run the fixed-window sample after network access and source admission are available; retain the sampled URLs, dedup decisions, publication evidence, and two reviewer decisions without storing unlicensed article text.

Because the gate has not passed, the local alternative investigation in [local-crime-news-alternative.md](../source-policies/local-crime-news-alternative.md) is active. Until a compliant source is selected and integrated, the product must display the crime-news category as incomplete rather than imply that there were no incidents.
