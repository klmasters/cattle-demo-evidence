// The v8 data model, in one place: the allowed values and the Events columns, in the order
// they appear in a spreadsheet. The animal-history download uses this now; the upload
// validator and the templates move onto it when they are reworked for v8.

export const EVENT_TYPES = ['worked', 'moved', 'birth', 'purchase', 'sold', 'deceased']
export const LOCATIONS = ['Home Pasture', 'North Pasture', 'South Pasture']
export const ANIMAL_TYPES = ['Cow', 'Bull', 'Calf']
export const GENDERS = ['Female', 'Male']

// kind: how the value is written and formatted ('text' keeps 0012 as 0012; 'str' is plain text).
// list: the dropdown choices. readonly: shaded in the sheet (a hint not to edit it).
export const EVENT_COLUMNS = [
  { key: 'row_id', kind: 'text', width: 38, readonly: true },
  { key: 'tag_number', kind: 'text', width: 12 },
  { key: 'event_date', kind: 'date', width: 13 },
  { key: 'event_type', kind: 'str', width: 13, list: EVENT_TYPES },
  { key: 'location', kind: 'str', width: 16, list: LOCATIONS },
  { key: 'type', kind: 'str', width: 9, list: ANIMAL_TYPES },
  { key: 'gender', kind: 'str', width: 10, list: GENDERS },
  { key: 'birth_year', kind: 'number', width: 11 },
  { key: 'mother_tag_number', kind: 'text', width: 18 },
  { key: 'date_bought', kind: 'date', width: 13 },
  { key: 'weight_lbs', kind: 'number', width: 11 },
  { key: 'estimated_months_pregnant', kind: 'number', width: 25 },
  { key: 'notes', kind: 'str', width: 60 },
]
