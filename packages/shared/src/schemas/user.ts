import { z } from 'zod';

import { fullNameField, nigerianPhoneField } from './fields.js';

export const updateMyProfileSchema = z
  .object({
    fullName: fullNameField,
    phone: nigerianPhoneField.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateMyProfileInput = z.input<typeof updateMyProfileSchema>;
