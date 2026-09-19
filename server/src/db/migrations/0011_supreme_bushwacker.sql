CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_created_idx" ON "reviews" USING btree ("pr_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_ws_idx" ON "reviews" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "reviews_run_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_skills_skill_idx" ON "agent_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "agents_ws_idx" ON "agents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_ran_idx" ON "agent_runs" USING btree ("pr_id","ran_at");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_idx" ON "agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "multi_agent_runs_ws_idx" ON "multi_agent_runs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "multi_agent_runs_pr_idx" ON "multi_agent_runs" USING btree ("pr_id");