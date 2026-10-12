---
title: Herd Overview
sidebar_position: 1
---

This report shows a snapshot of the current: every animal that has not been sold or died.

<KMStats>
  <BigValue data={total} value=herd title="Total herd" />
  <BigValue data={total} value=bulls title="Total bulls" />
  <BigValue data={total} value=calves title="Total calves" />
  <BigValue data={total} value=cows title="Total cows" />
</KMStats>

```sql total
select
  count(*) as herd,
  count(*) filter (where type = 'Bull') as bulls,
  count(*) filter (where type = 'Calf') as calves,
  count(*) filter (where type = 'Cow') as cows
from raw_current_cattle
```

```sql by_breed
select breed, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql by_location
select location, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql by_birth_year
select cast(cast(birth_year as integer) as varchar) as birth_year, count(*) as animals
from raw_current_cattle
group by 1
order by 1
```

```sql weight_by_breed
-- Each sold calf's last weight on or before its sale date, averaged by breed.
with sales as (
  select tag_number, cast(event_date as date) as sale_date, breed
  from raw_cattle_events
  where event_type = 'sold'
),
last_weight as (
  select
    s.tag_number,
    any_value(s.breed) as breed,
    arg_max(e.weight_lbs, (cast(e.event_date as date), e.id)) as weight_lbs
  from sales s
  join raw_cattle_events e
    on e.tag_number = s.tag_number
   and e.event_type = 'weight'
   and e.weight_lbs is not null
   and cast(e.event_date as date) <= s.sale_date
  group by 1
)
select breed, round(avg(weight_lbs)) as avg_weight_lbs
from last_weight
group by 1
order by 2 desc
```

```sql top_mothers
-- Mother cows still on the ranch, ranked by the average price per head her sold calves brought.
-- tag_numbers on a transaction is a comma-separated list, so split it into one row per tag.
with calves as (
  select tag_number as calf_tag, mother_tag_number
  from raw_cattle_events
  where event_type = 'birth' and mother_tag_number is not null
),
calf_sales as (
  select
    trim(unnest(string_split(tag_numbers, ','))) as calf_tag,
    cast(transaction_date as date) as sale_date,
    price_per_head
  from raw_cattle_transactions
  where transaction_type = 'sale'
),
final_weight as (
  select
    s.calf_tag,
    arg_max(e.weight_lbs, (cast(e.event_date as date), e.id)) as weight_lbs
  from calf_sales s
  join raw_cattle_events e
    on e.tag_number = s.calf_tag
   and e.event_type = 'weight'
   and e.weight_lbs is not null
   and cast(e.event_date as date) <= s.sale_date
  group by 1
)
select
  c.mother_tag_number as cow,
  count(*) as calves_sold,
  round(avg(s.price_per_head)) as avg_sale_price,
  round(avg(w.weight_lbs)) as avg_final_weight_lbs
from calves c
join calf_sales s on s.calf_tag = c.calf_tag
join raw_current_cattle cur on cur.tag_number = c.mother_tag_number
left join final_weight w on w.calf_tag = c.calf_tag
group by 1
order by avg_sale_price desc, calves_sold desc
```

```sql weight_by_year
-- Each sold animal's last recorded weight on or before its sale date, averaged by sale year.
-- Cows have no weights, so only calves appear.
with sales as (
  select tag_number, cast(event_date as date) as sale_date
  from raw_cattle_events
  where event_type = 'sold'
),
last_weight as (
  select
    s.tag_number,
    s.sale_date,
    arg_max(e.weight_lbs, (cast(e.event_date as date), e.id)) as weight_lbs
  from sales s
  join raw_cattle_events e
    on e.tag_number = s.tag_number
   and e.event_type = 'weight'
   and e.weight_lbs is not null
   and cast(e.event_date as date) <= s.sale_date
  group by 1, 2
)
select
  cast(year(sale_date) as varchar) as year,
  round(avg(weight_lbs)) as avg_weight_lbs,
  count(*) as animals
from last_weight
group by 1
order by 1
```

<Grid cols=2>
  <KMBarChart data={by_breed} x=breed y=animals title="Cattle by Breed" />
  <KMBarChart data={by_location} x=location y=animals title="Cattle by Location" />
</Grid>

<KMBarChart data={by_birth_year} x=birth_year y=animals sort=false title="Cattle by Birth Year" />

<Grid cols=2>
  <KMBarChart data={weight_by_year} x=year y=avg_weight_lbs sort=false yFmt="#,##0" title="Average Final Weight Before Sale, by Year" />
  <KMBarChart data={weight_by_breed} x=breed y=avg_weight_lbs yFmt="#,##0" title="Calf Final Weight Before Sale, by Breed" />
</Grid>

### Cows with the Highest Calf Sale Price
<DataTable data={top_mothers} rows=10>
  <Column id=cow title="Cow tag" />
  <Column id=calves_sold title="Calves sold" />
  <Column id=avg_sale_price title="Avg sale price per head" fmt="$#,##0" />
  <Column id=avg_final_weight_lbs title="Avg final weight (lb)" fmt="#,##0" />
</DataTable>
