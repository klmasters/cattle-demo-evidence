---
title: Financial
sidebar_position: 3
---

Money in and out of the herd, from the transactions on record. The data is fake, generated for this demo.

```sql totals
select
  sum(total_amount) filter (where transaction_type = 'purchase') as spent,
  sum(total_amount) filter (where transaction_type = 'sale') as earned,
  sum(total_amount) filter (where transaction_type = 'sale')
    - sum(total_amount) filter (where transaction_type = 'purchase') as net
from raw_cattle_transactions
```

```sql by_year
select
  cast(year(cast(transaction_date as date)) as varchar) as year,
  case transaction_type when 'purchase' then 'Purchases' else 'Sales' end as direction,
  sum(total_amount) as amount
from raw_cattle_transactions
group by 1, 2
order by 1, 2
```

```sql by_month
with months as (
  select unnest(generate_series(
    (select date_trunc('month', min(cast(transaction_date as date))) from raw_cattle_transactions),
    (select date_trunc('month', max(cast(transaction_date as date))) from raw_cattle_transactions),
    interval 1 month
  )) as month
),
directions as (
  select 'Purchases' as direction union all select 'Sales'
),
monthly as (
  select
    date_trunc('month', cast(transaction_date as date)) as month,
    case transaction_type when 'purchase' then 'Purchases' else 'Sales' end as direction,
    sum(total_amount) as amount
  from raw_cattle_transactions
  group by 1, 2
)
select cast(m.month as date) as month, d.direction, coalesce(t.amount, 0) as amount
from months m
cross join directions d
left join monthly t on t.month = m.month and t.direction = d.direction
order by 1, 2
```

```sql avg_price
select
  case transaction_type when 'purchase' then 'Purchases' else 'Sales' end as direction,
  round(sum(total_amount) / sum(head_count)) as price_per_head
from raw_cattle_transactions
group by 1
order by 1
```

```sql recent
select
  cast(transaction_date as date) as transaction_date,
  case transaction_type when 'purchase' then 'Purchase' else 'Sale' end as type,
  head_count,
  price_per_head,
  total_amount,
  notes
from raw_cattle_transactions
order by transaction_date desc, transaction_id desc
```

<KMStats>
  <BigValue data={totals} value=spent title="Spent on purchases" fmt=usd0 />
  <BigValue data={totals} value=earned title="Earned from sales" fmt=usd0 />
  <BigValue data={totals} value=net title="Net position" fmt=usd0 />
</KMStats>

Net position is sales minus purchases. It counts only the buying and selling of cattle, not feed, vet bills or other costs, so it is not profit.

## Over time

### Purchases vs sales by year
<KMBarChart data={by_year} x=year y=amount series=direction type=grouped yFmt=usd0 seriesColors={{ "Purchases": "#e8843e", "Sales": "#2f7d3c" }} />

### Money in vs money out by month
Months with no transactions show as zero.

<KMLineChart data={by_month} x=month y=amount series=direction yFmt=usd0 xFmt="mmm yyyy" seriesColors={{ "Purchases": "#e8843e", "Sales": "#2f7d3c" }} />

## Prices

### Average price per head
Purchases are breeding stock (cows and bulls) and sales are almost all calves, so the two prices are not like for like.

<KMBarChart data={avg_price} x=direction y=price_per_head series=direction yFmt=usd0 legend=false seriesColors={{ "Purchases": "#e8843e", "Sales": "#2f7d3c" }} />

## Transactions

### Recent transactions
<DataTable data={recent} rows=10>
  <Column id=transaction_date title="Date" fmt="yyyy-mm-dd" />
  <Column id=type title="Type" />
  <Column id=head_count title="Head" />
  <Column id=price_per_head title="Price per head" fmt=usd0 />
  <Column id=total_amount title="Total" fmt=usd0 />
  <Column id=notes title="Notes" />
</DataTable>
