import { ResponseError } from "../error/response-error";
import { prismaClient } from "../lib/prisma";

export type Taxonomy = {
  categories: { key: string; name: string }[];
  scopes: { key: string; name: string }[];
};

// The kinds of tool and the product spaces an application can be put in, in the order they were made.
export class ApplicationTaxonomyService {
  static async list(): Promise<Taxonomy> {
    const [categories, scopes] = await Promise.all([
      prismaClient.applicationCategory.findMany({ orderBy: { created_at: "asc" }, select: { key: true, name: true } }),
      prismaClient.applicationScope.findMany({ orderBy: { created_at: "asc" }, select: { key: true, name: true } }),
    ]);
    return { categories, scopes };
  }

  // Empty means none. Anything else has to be in the lists.
  static async assertKnown(values: { category?: string | null; scope?: string | null }): Promise<void> {
    const category = values.category?.trim();
    const scope = values.scope?.trim();
    if (category && !(await prismaClient.applicationCategory.findUnique({ where: { key: category } }))) {
      throw new ResponseError(400, "Pick a category from the list");
    }
    if (scope && !(await prismaClient.applicationScope.findUnique({ where: { key: scope } }))) {
      throw new ResponseError(400, "Pick a scope from the list");
    }
  }
}
