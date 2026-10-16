import { z } from 'zod';

// P18 (v1.1) D2: the wire shape for a connection's pasted DDL document — the raw text only. The
// parsed table/column model the SQL language service actually completes/diagnoses/hovers against
// (views/console/ddl.ts's DdlSchema) is derived client-side from this text and never crosses the
// wire itself.
export const connectionDdlSchema = /*#__PURE__*/ z.object({
  connectionId: z.string(),
  ddl: z.string(),
  /** ISO timestamp of the last Save; '' for a connection with no saved document (D2: absent
   *  until the user writes one, not an error). */
  updatedAt: z.string(),
});
export type ConnectionDdl = z.infer<typeof connectionDdlSchema>;
