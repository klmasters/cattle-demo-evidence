---
title: Upload Your Own Data
sidebar_position: 5
---

The demo herd currently holds <Value data={herd_size} column=events fmt=num0 /> events across <Value data={herd_size} column=animals fmt=num0 /> animals. Try it with your own cattle events. Download the template, fill in a few rows, upload it here, and the new animals and events show up on the other dashboards. Everything is checked row by row first; if anything is wrong, nothing is saved and you are told which cell to fix.

This is a public demo, so please use made-up data. Uploads are added to the shared herd and can be removed at any time.

## 1. Download the template

<a href="/ranch-demo/cattle_upload_template.xlsx" download data-sveltekit-reload style="display:inline-block;margin:0.25rem 0 0.9rem;color:#3d6642;font-weight:600;text-decoration:underline">Download the Excel template</a>

It has an Events tab (one row per thing that happened to an animal), an optional Transactions tab (purchases and sales, with money), and a Herd tab listing the animals already on the ranch. Using Numbers or Google Sheets? Open the template there, fill it in, then export it as .xlsx, or share the Google Sheet with "Anyone with the link" and paste the link below.

## 2. Upload it

<UploadForm />

Dashboards update about 2 to 3 minutes after a successful upload.

<!-- Queries go at the bottom of the page. This one is also what makes Evidence write a
     data file for this page: a page with no query at all gets no file, and the site then
     fails while loading it (the server answers the missing file with an HTML page). -->
```sql herd_size
select count(*) as events, count(distinct tag_number) as animals from raw_cattle_events
```
