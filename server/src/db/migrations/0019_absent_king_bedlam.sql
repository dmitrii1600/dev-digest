DROP INDEX "eval_runs_one_running_suite_uq";--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "single_case_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_single_case_id_eval_cases_id_fk" FOREIGN KEY ("single_case_id") REFERENCES "public"."eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_single_uq" ON "eval_runs" USING btree ("single_case_id") WHERE "eval_runs"."status" = 'running' and "eval_runs"."kind" = 'single';--> statement-breakpoint
CREATE INDEX "eval_runs_single_case_idx" ON "eval_runs" USING btree ("single_case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_suite_uq" ON "eval_runs" USING btree ("owner_id") WHERE "eval_runs"."status" = 'running' and "eval_runs"."kind" = 'suite';