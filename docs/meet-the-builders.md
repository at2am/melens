# Melens: making Melbourne's local data easier to understand

*By Alex Gao · 8 October 2026*

I'm building Melens with a team to help people understand what's happening around them in Melbourne. The idea is to put local information on a map, then let people ask questions about the places they can see.

A city publishes plenty of useful information, but it does not all describe the same place, time or kind of fact. A parking sensor reports an observation. A development record describes a project's status. A rental statistic describes a past quarter. A news article may mention a suburb without identifying where an event happened. Bringing these together takes more than adding markers to a map.

For Melens, the question is simple: how can we make this information useful without making it sound more current, precise or certain than it really is?

## Starting with Melbourne's data

We chose the City of Melbourne as the initial focus, with wider Victorian sources where their actual coverage supports it. The project brings together council datasets and other sources for planning, parking, local news, events and regional statistics. Each source keeps its own geographic coverage and update frequency.

I started with the data foundation because an AI answer will only be useful if the facts behind it are reliable. We built connectors that preserve source links, timestamps, units, geographic precision and missing values. Records go through validation before they become available to downstream queries.

One concrete example is parking. Our 1 October cloud validation read back 6,324 parking sensors. That proved we could collect and query the sensor records. It did not prove that every reading was fresh, or that a bay reported as vacant was legally available to park in. The implementation keeps reported occupancy separate from parking rules and leaves an unverified legal answer unknown.

That distinction shapes the rest of Melens too. Missing observations do not become zero. Historical statistics do not become live conditions. An article's place reference does not become an invented street coordinate.

## What we have built on Google Cloud

The data pipeline runs on Google Cloud. Cloud Run Jobs execute collection and normalization, Cloud Scheduler triggers refreshes, and BigQuery stores published records and query views. Cloud Build packages the services, and Secret Manager supplies credentials to the jobs that need them. We have recorded successful cloud executions, scheduled refreshes and BigQuery readbacks, rather than relying only on test data.

We also built a Flutter map interface using Google Maps and a separate, read-only Cloud Run query service. A validated development preview displayed real Melbourne development-planning records. People could select a group of markers, inspect its original records and open their source links. The same detail view worked in desktop and narrow mobile browser layouts.

This is still a prototype. The planning preview is the verified live map path; not every collected source is available as a finished map experience. Full product acceptance and map performance work remain open.

## Where generative AI fits

Google AI has already been part of our development process. I used Gemini coding agents for scoped data-connector and validation tasks, then reviewed and integrated the deliveries. The repository records those handoffs and their verification results. An agent producing code was a starting point; we still needed to check real source fields, query behavior and cloud execution.

Inside the product, the planned generative AI experience uses Gemini with Google's Agent Development Kit on Cloud Run. It is designed to answer questions such as "What is happening here?" and help explain the map through tools that retrieve source-backed records. Specific recommendations would appear with their supporting records or links, and possible causes would carry uncertainty.

That product agent is a design and integration goal, not a working deployed chat experience yet. The implemented Google Cloud pipeline and map preview are the foundation for it. I want the model to explain evidence the system has actually retrieved and acknowledge what the data cannot answer.

## What building Melens has taught me

The most useful progress has come from making the limits visible. A successful API response can still contain old data. A passing test can still miss a problem in a real query. A readable map can still give the wrong impression if it hides the source's coverage or timestamp.

My next step is to connect the Gemini experience to the verified data tools, complete the remaining live-source and performance checks, and evaluate the answers against concrete Melbourne questions. The goal is a map that helps people understand local information and gives them a way to check it.
