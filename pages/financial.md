---
title: Financial
sidebar_position: 3
---

Money in and out of the herd, from the transactions on record. The data is fake, generated for this demo.

<KMStats>
  <BigValue data={totals} value=spent title="Spent on purchases" fmt=usd0 />
  <BigValue data={totals} value=earned title="Earned from sales" fmt=usd0 />
  <BigValue data={totals} value=net title="Net position" fmt=usd0 />
</KMStats>

### Purchases vs sales by year
<KMBarChart data={by_year} x=year y=amount series=direction type=grouped sort=false yFmt=usd0 seriesColors={{ "Purchases": "#e8843e", "Sales": "#2f7d3c" }} />

### Prices by year
<Grid cols=2>
  <KMBarChart data={cwt_by_year} x=year y=price_per_cwt series=category type=grouped sort=false yFmt="$#,##0" title="Sale price per cwt" seriesColors={{ "Calf sales": "#2f7d3c", "Cull cow sales": "#3f8fc4" }} />
  <KMBarChart data={head_by_year} x=year y=price_per_head series=category type=grouped sort=false yFmt=usd0 title="Average price per head" seriesColors={{ "Calf sales": "#2f7d3c", "Cull cow sales": "#3f8fc4", "Cow purchases": "#e8843e", "Bull purchases": "#8f3d56" }} />
</Grid>

## Transactions

### All transactions
<DataTable data={recent} rows=12>
  <Column id=transaction_date title="Date" fmt="yyyy-mm-dd" />
  <Column id=category title="Type" />
  <Column id=head_count title="Head" />
  <Column id=avg_weight_lbs title="Avg weight (lb)" fmt="#,##0" />
  <Column id=price_per_cwt title="Price per cwt" fmt="$#,##0.00" />
  <Column id=price_per_head title="Price per head" fmt=usd0 />
  <Column id=total_amount title="Total" fmt=usd0 />
  <Column id=notes title="Notes" />
</DataTable>

<!-- Queries: kept at the bottom so the page layout reads top to bottom. -->

```sql totals
select
  sum(total_amount) filter (where transaction_type = 'purchase') as spent,
  sum(total_amount) filter (where transaction_type = 'sale') as earned,
  sum(total_amount) filter (where transaction_type = 'sale')
    - sum(total_amount) filter (where transaction_type = 'purchase') as net
from raw_cattle_transactions
```

```sql by_year
-- Every year gets a row for both directions (zero when there is nothing). Without that, a year
-- with only sales is missing from the Purchases series and the chart puts it at the end.
with totals as (
  select
    cast(year(cast(transaction_date as date)) as varchar) as year,
    case transaction_type when 'purchase' then 'Purchases' else 'Sales' end as direction,
    sum(total_amount) as amount
  from raw_cattle_transactions
  group by 1, 2
),
years as (select distinct year from totals),
directions as (select 'Purchases' as direction union all select 'Sales')
select y.year, d.direction, coalesce(t.amount, 0) as amount
from years y
cross join directions d
left join totals t on t.year = y.year and t.direction = d.direction
order by 1, 2
```

```sql cwt_by_year
-- Sales only. Price per cwt is weighted by pounds sold, so a big lot counts for more than a small one.
select
  cast(year(cast(transaction_date as date)) as varchar) as year,
  case when notes ilike '%cull%' then 'Cull cow sales' else 'Calf sales' end as category,
  round(sum(total_amount) / sum(total_weight_lbs) * 100, 2) as price_per_cwt
from raw_cattle_transactions
where transaction_type = 'sale'
group by 1, 2
order by 1, 2
```

```sql head_by_year
-- Average price per head, weighted by head, for each kind of transaction. Every year gets a row for
-- every category (blank price when there were none), so grouped bars keep the years in order.
with typed as (
  select
    cast(year(cast(transaction_date as date)) as varchar) as year,
    case
      when transaction_type = 'purchase' and notes ilike '%bull%' then 'Bull purchases'
      when transaction_type = 'purchase' then 'Cow purchases'
      when notes ilike '%cull%' then 'Cull cow sales'
      else 'Calf sales'
    end as category,
    total_amount,
    head_count
  from raw_cattle_transactions
),
prices as (
  select year, category, round(sum(total_amount) / sum(head_count)) as price_per_head
  from typed
  group by 1, 2
),
years as (select distinct year from typed),
categories as (select distinct category from typed)
select y.year, c.category, p.price_per_head
from years y
cross join categories c
left join prices p on p.year = y.year and p.category = c.category
order by 1, 2
```

```sql recent
select
  cast(transaction_date as date) as transaction_date,
  case
      when transaction_type = 'purchase' and notes ilike '%bull%' then 'Bull purchases'
      when transaction_type = 'purchase' then 'Cow purchases'
      when notes ilike '%cull%' then 'Cull cow sales'
      else 'Calf sales'
    end as category,
  head_count,
  round(total_weight_lbs / head_count) as avg_weight_lbs,
  price_per_cwt,
  price_per_head,
  total_amount,
  notes
from raw_cattle_transactions
order by transaction_date desc, transaction_id desc
```
