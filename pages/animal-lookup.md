---
title: Animal Lookup
sidebar_position: 4
---

Pick a tag number to see one animal's whole record. This page reads every event on file, so animals that were sold or have died can be looked up too. The data is fake, generated for this demo.

```sql tags
select tag_number
from raw_cattle_events
group by 1
order by cast(tag_number as integer)
```

<Dropdown name=tag data={tags} value=tag_number title="Tag number" defaultValue="248" />

<KMStats>
  <BigValue data={animal} value=breed title="Breed" />
  <BigValue data={animal} value=type title="Type" />
  <BigValue data={animal} value=birth_year title="Birth Year" fmt="0" />
  <BigValue data={animal} value=location title="Last Location" />
</KMStats>

<div class="km-split">
  <div>
    <BigValue data={animal} value=status title="Current Status" />
    <BigValue data={purchase} value=purchase_date title="Purchase Date" />
  </div>
  <KMBarChart data={event_counts} x=event_type y=events title="Events by Type" />
</div>

<KMStats>
  <BigValue data={extras} value=mother_tag title="Mother Tag" />
  <BigValue data={extras} value=calves title="Calves Born" fmt="0" />
  <BigValue data={extras} value=last_weight title="Last Weight (lb)" />
</KMStats>

```sql animal
with latest as (
  select tag_number, event_type, location,
    row_number() over (order by event_date desc, id desc) as rn
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
),
info as (
  select any_value(breed) as breed, any_value(type) as type,
    cast(any_value(birth_year) as integer) as birth_year,
    any_value(mother_tag_number) as mother_tag
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
),
offspring as (
  select count(*) as calves
  from raw_cattle_events
  where event_type = 'birth' and mother_tag_number = '${inputs.tag.value}'
),
last_weight as (
  select weight_lbs
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}' and event_type = 'weight'
  order by event_date desc, id desc
  limit 1
)
select
  '${inputs.tag.value}' as tag,
  case l.event_type when 'sold' then 'Sold' when 'deceased' then 'Deceased' else 'Active' end as status,
  i.type, i.breed, l.location, i.birth_year, i.mother_tag, o.calves,
  w.weight_lbs as last_weight_lbs
from latest l
cross join info i
cross join offspring o
left join last_weight w on true
where l.rn = 1
```

```sql extras
-- Text fallbacks so animals without a mother or any weights show "None" instead of a blank tile.
select
  coalesce(mother_tag, 'None') as mother_tag,
  calves,
  coalesce(format('{:,}', cast(round(last_weight_lbs) as integer)), 'None') as last_weight
from ${animal}
```

```sql purchase
-- Animals born on the ranch or in the original herd have no purchase event.
select coalesce(strftime(min(cast(event_date as date)), '%b %-d, %Y'), 'Not purchased') as purchase_date
from raw_cattle_events
where tag_number = '${inputs.tag.value}' and event_type = 'purchase'
```

```sql calves
-- Calves of the selected cow. A transaction's tag_numbers is a comma-separated list, so split
-- it into one row per tag and match exactly (a LIKE match would hit part of other tags).
-- sold_date is text because a table formats a missing date as 1970-01-01.
with last_weight as (
  select tag_number, arg_max(weight_lbs, (cast(event_date as date), id)) as weight_lbs
  from raw_cattle_events
  where event_type = 'weight' and weight_lbs is not null
  group by 1
),
sales as (
  select
    trim(unnest(string_split(tag_numbers, ','))) as tag_number,
    cast(transaction_date as date) as sold_date,
    price_per_head
  from raw_cattle_transactions
  where transaction_type = 'sale'
)
select
  b.tag_number as calf_tag,
  cast(b.event_date as date) as birth_date,
  w.weight_lbs as most_recent_weight,
  strftime(s.sold_date, '%Y-%m-%d') as sold_date,
  s.price_per_head as sold_price
from raw_cattle_events b
left join last_weight w on w.tag_number = b.tag_number
left join sales s on s.tag_number = b.tag_number
where b.event_type = 'birth' and b.mother_tag_number = '${inputs.tag.value}'
order by b.event_date
```

```sql history
select
  cast(event_date as date) as event_date,
  event_type,
  notes,
  weight_lbs
from raw_cattle_events
where tag_number = '${inputs.tag.value}'
order by event_date, id
```

```sql event_counts
select event_type, count(*) as events
from raw_cattle_events
where tag_number = '${inputs.tag.value}'
group by 1
order by 2 desc, 1
```

```sql weights
select cast(event_date as date) as event_date, weight_lbs
from raw_cattle_events
where tag_number = '${inputs.tag.value}' and event_type = 'weight'
order by event_date, id
```

## Calves
{#if calves.length > 0}

<DataTable data={calves} rows=10>
  <Column id=calf_tag title="Calf tag" />
  <Column id=birth_date title="Birth date" fmt="yyyy-mm-dd" />
  <Column id=most_recent_weight title="Most recent weight (lb)" fmt="#,##0" />
  <Column id=sold_date title="Sold date" />
  <Column id=sold_price title="Sold price per head" fmt="$#,##0" />
</DataTable>

{:else}

This animal has no calves on record.

{/if}

## Event history
A birth and its birth weight are recorded on the same day, so a date can appear twice.

<DataTable data={history} rows=15>
  <Column id=event_date title="Date" fmt="yyyy-mm-dd" />
  <Column id=event_type title="Event" />
  <Column id=notes title="Notes" />
  <Column id=weight_lbs title="Weight (lb)" fmt="#,##0" />
</DataTable>

## Weight history
{#if weights.length > 0}

<KMLineChart data={weights} x=event_date y=weight_lbs markers=true xFmt="mmm d, yyyy" yFmt="#,##0" />

{:else}

No weights are on file for this animal. In this data only calves are weighed.

{/if}

**Not sure where to start? Try these tags:**

| Tag | Animal | Why look |
|-----|--------|----------|
| 248 | Calf | Born, weighed three times, then sold in the winter sale |
| 484 | Calf | The heaviest calf on record: 750 lb at its last weigh-in |
| 664 | Calf | Born in April 2026 and still on the ranch |
| 225 | Calf | Died in July 2022, three months after birth |
| 101 | Cow | In the original herd, with five calves over five seasons |
| 262 | Cow | Bought in 2022, then four calves and a yearly pregnancy check |
| 106 | Cow | Culled in 2023 as an open cow, meaning not pregnant |
| 368 | Cow | Bought in 2023 and found dead in December 2025 |
| 272 | Bull | Bought in 2022 and still on the ranch |
| 183 | Bull | Died in August 2025 |
