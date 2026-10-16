---
title: Pre-filled Template
sidebar_link: false
---

A test page, not linked from the rest of the site. It builds the upload template with a row already in it for each of the <Value data={herd_size} column=animals fmt=num0 /> animals on the ranch.

Say what you did and when, and you get the template back with every animal's tag, breed, type and location filled in. Delete the rows for animals you did not work, fill in anything left blank (a weight, for instance), then upload the file on the [upload page](/ranch-demo/upload/). Every row left in the file is saved as an event, so remove the ones that do not apply.

This is a public demo, so please use made-up data.

<TemplateForm noindex />

<!-- Queries go at the bottom of the page. A page with no query at all gets no data file, and
     the site then fails while loading it. -->
```sql herd_size
select count(*) as animals from raw_current_cattle
```
