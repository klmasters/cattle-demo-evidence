---
title: Animal Lookup
sidebar_position: 4
---

Pick a tag number to see one animal's whole record. This page reads every event on file, so animals that were sold or have died can be looked up too. The data is fake, generated for this demo.

<div class="km-small-text">

**Not sure where to start? Try these tags:**

| Tag | Animal | Why look |
|-----|--------|----------|
| 248 | Calf | Born April 2024, weighed, then sold that October |
| 184 | Calf | Born and died on the same day |
| 267 | Cow | Bought in 2024, two calves, still on the ranch |
| 160 | Cow | Original herd, three calves, sold as a cull in 2026 |
| 183 | Bull | Original herd, still on the ranch, moved between pastures |

</div>

<Dropdown name=tag data={tags} value=tag_number title="Tag number" defaultValue="248" />

<div class="km-small-values">
<KMStats>
  <BigValue data={animal} value=type title="Type" />
  <BigValue data={animal} value=gender title="Gender" />
  <BigValue data={animal} value=birth_year title="Birth Year" fmt="0" />
  <BigValue data={extras} value=mother_tag title="Mother Tag" />
</KMStats>
<KMStats>
  <BigValue data={acquired} value=acquired title="Acquired" />
  <BigValue data={animal} value=status title="Current Status" />
  <BigValue data={animal} value=location title="Last Location" />
  <BigValue data={extras} value=last_weight title="Last Weight (lb)" />
</KMStats>
</div>

## Calves
{#if calves.length > 0}

<DataTable data={calves} rows=10>
  <Column id=calf_tag title="Calf tag" />
  <Column id=birth_date title="Birth date" fmt="yyyy-mm-dd" />
  <Column id=birth_weight title="Birth weight (lb)" fmt="#,##0" />
  <Column id=outcome title="Outcome" />
  <Column id=sold_weight title="Sold weight (lb)" fmt="#,##0" />
  <Column id=sold_price title="Sold price" fmt="$#,##0" />
</DataTable>

{:else}

This animal has no calves on record.

{/if}

## Event history
Download this animal's full record as a spreadsheet, one row per event.

<HistoryDownload tag={inputs.tag.value} />

<DataTable data={history} rows=15>
  <Column id=event_date title="Date" fmt="yyyy-mm-dd" />
  <Column id=event_type title="Event" />
  <Column id=location title="Location" />
  <Column id=weight_lbs title="Weight (lb)" fmt="#,##0" />
  <Column id=notes title="Notes" />
</DataTable>

<Grid cols=2>
  {#if weights.length > 0}
    <KMLineChart data={weights} x=event_date y=weight_lbs markers=true xFmt="mmm d, yyyy" yFmt="#,##0" title="Weight History" />
  {:else}
    <div>
      <p><strong>Weight History</strong></p>
      <p>No weights are on file for this animal.</p>
    </div>
  {/if}
  <KMBarChart data={event_counts} x=event_type y=events title="Events by Type" />
</Grid>

<!-- Queries: kept at the bottom so the page layout reads top to bottom. -->

```sql tags
select tag_number
from raw_cattle_events
group by 1
order by try_cast(tag_number as integer) nulls last, tag_number
```

```sql animal
-- Status and last location come from the latest event; a sold or deceased event wins a same-day tie.
with latest as (
  select event_type, location
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
  order by cast(event_date as date) desc, (event_type in ('sold', 'deceased')) desc, id desc
  limit 1
),
info as (
  select
    any_value(type) as type,
    any_value(gender) as gender,
    cast(any_value(birth_year) as integer) as birth_year,
    max(mother_tag_number) as mother_tag,
    (select count(*) from raw_cattle_events
      where event_type = 'birth' and mother_tag_number = '${inputs.tag.value}') as calves
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}'
),
last_weight as (
  select weight_lbs
  from raw_cattle_events
  where tag_number = '${inputs.tag.value}' and weight_lbs is not null
  order by cast(event_date as date) desc, id desc
  limit 1
)
select
  '${inputs.tag.value}' as tag,
  case l.event_type when 'sold' then 'Sold' when 'deceased' then 'Deceased' else 'Active' end as status,
  i.type, i.gender, l.location, i.birth_year, i.mother_tag, i.calves,
  w.weight_lbs as last_weight_lbs
from latest l
cross join info i
left join last_weight w on true
```

```sql extras
-- Text fallbacks so animals without a mother or any weights show "None" instead of a blank tile.
select
  coalesce(mother_tag, 'None') as mother_tag,
  calves,
  coalesce(format('{:,}', cast(round(last_weight_lbs) as integer)), 'None') as last_weight
from ${animal}
```

```sql acquired
-- Bought animals carry a purchase date. Otherwise the animal was born on the ranch (it has a birth
-- event of its own) or was already in the original herd when records began.
select
  case
    when max(date_bought) is not null then strftime(max(cast(date_bought as date)), '%b %-d, %Y')
    when count(*) filter (where event_type = 'birth') > 0 then 'Born on ranch'
    else 'Original herd'
  end as acquired
from raw_cattle_events
where tag_number = '${inputs.tag.value}'
```

```sql calves
-- Calves of the selected cow. A transaction's tag_numbers is a comma-separated list, so split it
-- into one row per tag and match exactly (a LIKE match would hit part of other tags).
-- A sold calf's price is its sold weight times the lot's price per cwt. Outcome is text because
-- a table shows a missing date as 1970-01-01.
with sales as (
  select
    trim(unnest(string_split(tag_numbers, ','))) as tag_number,
    price_per_cwt
  from raw_cattle_transactions
  where transaction_type = 'sale'
),
sold as (
  select tag_number, cast(event_date as date) as sold_date, weight_lbs as sold_weight
  from raw_cattle_events
  where event_type = 'sold'
),
died as (
  select tag_number, cast(event_date as date) as died_date
  from raw_cattle_events
  where event_type = 'deceased'
)
select
  b.tag_number as calf_tag,
  cast(b.event_date as date) as birth_date,
  b.weight_lbs as birth_weight,
  case
    when s.sold_date is not null then 'Sold ' || strftime(s.sold_date, '%b %-d, %Y')
    when d.died_date is not null then 'Died ' || strftime(d.died_date, '%b %-d, %Y')
    else 'On the ranch'
  end as outcome,
  s.sold_weight,
  round(s.sold_weight * x.price_per_cwt / 100) as sold_price
from raw_cattle_events b
left join sold s on s.tag_number = b.tag_number
left join died d on d.tag_number = b.tag_number
left join sales x on x.tag_number = b.tag_number
where b.event_type = 'birth' and b.mother_tag_number = '${inputs.tag.value}'
order by b.event_date
```

```sql history
select
  cast(event_date as date) as event_date,
  event_type,
  location,
  weight_lbs,
  notes
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
where tag_number = '${inputs.tag.value}' and weight_lbs is not null
order by event_date, id
```
