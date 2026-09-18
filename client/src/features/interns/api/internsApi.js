import { createBulkCrudApi, createCrudApi } from '../../../lib/crudApi.js'

export const internSortFields = [
  'created_at',
  'full_name',
  'nick_name',
  'email',
  'status',
  'join_date',
  'end_date',
]

export const internStatuses = ['ACTIVE', 'COMPLETED', 'TERMINATED']

export const genderOptions = ['MALE', 'FEMALE']

export const religionOptions = [
  'ISLAM',
  'PROTESTANTISM',
  'CATHOLICISM',
  'HINDUISM',
  'BUDDHISM',
  'CONFUCIANISM',
  'OTHER',
]

export const educationLevels = [
  'SD',
  'SMP',
  'SMA_SMK',
  'D1',
  'D2',
  'D3',
  'D4',
  'S1',
  'S2',
  'S3',
]

export const internsApi = {
  ...createCrudApi('/api/admin/interns'),
  ...createBulkCrudApi('/api/admin/interns'),
}
