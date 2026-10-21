import { PersonType } from "../generated/prisma/client";
import { prismaClient } from "../lib/prisma";

// An admin is made from an employee. This is the bridge between the two tables: AdminUser.person_id. It is filled in
// when the admin signs in, when their profile is opened, and when the employee is created, whichever comes first.

// The employee with this email, if that person is not already linked to another admin. The email is compared without
// caring about capitals.
export async function findLinkablePersonId(email: string): Promise<string | null> {
  const person = await prismaClient.person.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      person_type: PersonType.EMPLOYEE,
      deleted_at: null,
      employee: { deleted_at: null },
      adminUser: { is: null },
    },
    select: { id: true },
  });
  return person?.id ?? null;
}

// Links the admin with this email to their employee record, only when they are not linked yet. Returns the person id
// they are linked to now, or null.
export async function linkAdminToEmployee(adminEmail: string): Promise<string | null> {
  const admin = await prismaClient.adminUser.findFirst({
    where: { email: { equals: adminEmail, mode: "insensitive" } },
    select: { id: true, person_id: true },
  });
  if (!admin) return null;
  if (admin.person_id) return admin.person_id;
  const personId = await findLinkablePersonId(adminEmail);
  if (!personId) return null;
  await prismaClient.adminUser.update({ where: { id: admin.id }, data: { person_id: personId } });
  return personId;
}
