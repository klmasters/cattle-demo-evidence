---
title: Herd Overview
sidebar_position: 1
---

This report shows a snapshot of the current herd: every animal that has not been sold or died.

<KMStats>
  <BigValue data={total} value=herd title="Total herd" />
  <BigValue data={total} value=cows title="Total cows" />
  <BigValue data={total} value=bulls title="Total bulls" />
  <BigValue data={total} value=pregnant title="Cows pregnant" />
</KMStats>

<Grid cols=2>
  <KMBarChart data={by_location} x=location y=animals title="Cattle by Pasture" />
  <KMBarChart data={cows_by_age} x=age y=cows sort=false title="Cows by Age (years)" />
</Grid>

### Cow Weights
<Grid cols=2>
  <KMBarChart data={weight_by_location} x=location y=avg_weight_lbs yFmt="#,##0" title="Average Cow Weight by Pasture (lb)" />
  <KMBarChart data={weight_by_age} x=age y=avg_weight_lbs sort=false yFmt="#,##0" title="Average Cow Weight by Age (lb)" />
</Grid>

### Herd Over Time
<KMAreaChart data={herd_over_time} x=month y=animals series=type title="Head on the Ranch, Month End" />

### Calf Sales
<Grid cols=2>
  <KMBarChart data={calf_sales} x=year y=price_per_cwt yFmt="$#,##0" sort=false title="Calf Price per Cwt" />
  <KMBarChart data={calf_sales} x=year y=avg_weight_lbs yFmt="#,##0" sort=false title="Average Calf Sale Weight (lb)" />
</Grid>

<DataTable data={calf_sales}>
  <Column id=year title="Year" />
  <Column id=head_sold title="Calves sold" />
  <Column id=avg_weight_lbs title="Avg weight (lb)" fmt="#,##0" />
  <Column id=price_per_cwt title="Price per cwt" fmt="$#,##0.00" />
  <Column id=revenue title="Total received" fmt="$#,##0" />
</DataTable>

<!-- Queries: kept at the bottom so the page layout reads top to bottom. -->

```sql total
select
  count(*) as herd,
  count(*) filter (where type = 'Cow') as cows,
  count(*) filter (where type = 'Bull') as bulls,
  count(*) filter (where currently_pregnant) as pregnant
from raw_current_cattle
```

```sql by_location
select location, count(*) as animals
from raw_current_cattle
group by 1
order by 2 desc
```

```sql cows_by_age
-- Age is measured from the year of the latest event in the data, so it does not drift with today's date.
select
  cast(year(ref.d) - cur.birth_year as integer) as age,
  count(*) as cows
from raw_current_cattle cur
cross join (select max(event_date) as d from raw_cattle_events) ref
where cur.type = 'Cow'
group by 1
order by 1
```

```sql weight_by_location
select location, round(avg(last_weight_lbs)) as avg_weight_lbs
from raw_current_cattle
where type = 'Cow'
group by 1
order by 2 desc
```

```sql weight_by_age
select
  cast(year(ref.d) - cur.birth_year as integer) as age,
  round(avg(cur.last_weight_lbs)) as avg_weight_lbs
from raw_current_cattle cur
cross join (select max(event_date) as d from raw_cattle_events) ref
where cur.type = 'Cow'
group by 1
order by 1
```

```sql herd_over_time
-- Each animal is on the ranch from its first event until its sold or deceased event.
with bounds as (
  select cast(min(event_date) as date) as d0, cast(max(event_date) as date) as d1
  from raw_cattle_events
),
months as (
  select cast(m as date) as month_start
  from bounds, unnest(generate_series(date_trunc('month', d0), date_trunc('month', d1), interval 1 month)) as t(m)
),
animals as (
  select
    tag_number,
    any_value(type) as type,
    -- Starting-herd animals have no birth or purchase event, so they count from the first day of data.
    coalesce(cast(min(event_date) filter (where event_type in ('birth', 'purchase')) as date), (select d0 from bounds)) as entered,
    cast(min(event_date) filter (where event_type in ('sold', 'deceased')) as date) as left_on
  from raw_cattle_events
  group by 1
)
select
  m.month_start as month,
  a.type,
  count(*) as animals
from months m
join animals a
  on a.entered <= m.month_start + interval 1 month - interval 1 day
 and (a.left_on is null or a.left_on > m.month_start + interval 1 month - interval 1 day)
group by 1, 2
order by 1, 2
```

```sql calf_sales
-- Calf sale lots only (cull-cow sales are left out). Price is weighted by weight sold.
select
  cast(year(transaction_date) as varchar) as year,
  sum(head_count) as head_sold,
  round(sum(total_weight_lbs) / sum(head_count)) as avg_weight_lbs,
  round(sum(total_amount) / sum(total_weight_lbs) * 100, 2) as price_per_cwt,
  sum(total_amount) as revenue
from raw_cattle_transactions
where transaction_type = 'sale' and notes ilike '%calf sale%'
group by 1
order by 1
```
