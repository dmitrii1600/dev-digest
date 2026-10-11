CREATE TABLE "eval_run_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"case_name" text NOT NULL,
	"expectation" text NOT NULL,
	"target_file" text NOT NULL,
	"target_start_line" integer NOT NULL,
	"target_end_line" integer NOT NULL,
	"fingerprint" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"produced" integer DEFAULT 0 NOT NULL,
	"kept" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"nmf_hits" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"duration_ms" integer,
	"cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source" text DEFAULT 'finding' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "target_file" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "target_start_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "target_end_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "kind" text DEFAULT 'suite' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "owner_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "owner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "provider" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "model" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "skills" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "case_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_passed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_errored" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_run_cases" ADD CONSTRAINT "eval_run_cases_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_cases" ADD CONSTRAINT "eval_run_cases_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_run_cases_run_idx" ON "eval_run_cases" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_run_cases_case_idx" ON "eval_run_cases" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_kind","owner_id");--> statement-breakpoint
CREATE INDEX "eval_cases_ws_idx" ON "eval_cases" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_source_uq" ON "eval_cases" USING btree ("owner_id","source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_cases_source_finding_idx" ON "eval_cases" USING btree ("source_finding_id");--> statement-breakpoint
CREATE INDEX "eval_runs_agent_ran_idx" ON "eval_runs" USING btree ("agent_id","ran_at");--> statement-breakpoint
CREATE INDEX "eval_runs_ws_idx" ON "eval_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_one_running_suite_uq" ON "eval_runs" USING btree ("agent_id") WHERE "eval_runs"."status" = 'running' and "eval_runs"."kind" = 'suite';