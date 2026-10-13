# Breaking change

Flag any change that makes an EXISTING caller fail at runtime or at the type
level: a removed or renamed field or route, a narrowed type, a new required
input, a changed status code, a changed HTTP method. Additive changes — a new
optional field, a new endpoint — are not breaking.

Ask of every contract touched by the diff: "does a caller written against
yesterday's shape still work today?" If the answer is no and the change ships
under the same route and version, report it.

**Good** — additive, callers keep working:

```ts
export const Repo = z.object({
  id: z.string(),
  full_name: z.string(),
  last_polled_at: z.string().nullish(), // new, optional
});
```

**Bad** — a field renamed and a type narrowed in one move:

```ts
export const Repo = z.object({
  id: z.string(),
  fullName: z.string(),        // was full_name — every reader of full_name breaks
  last_polled_at: z.string(),  // was nullish — a null now fails validation
});
```