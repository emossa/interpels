CREATE TABLE "possibile_duplicato" (
	"interpello_a" integer NOT NULL,
	"interpello_b" integer NOT NULL,
	CONSTRAINT "possibile_duplicato_interpello_a_interpello_b_pk" PRIMARY KEY("interpello_a","interpello_b"),
	CONSTRAINT "possibile_duplicato_ordinato" CHECK ("possibile_duplicato"."interpello_a" < "possibile_duplicato"."interpello_b")
);
--> statement-breakpoint
ALTER TABLE "interpello" ADD COLUMN "impronta" text;--> statement-breakpoint
ALTER TABLE "possibile_duplicato" ADD CONSTRAINT "possibile_duplicato_interpello_a_interpello_id_fk" FOREIGN KEY ("interpello_a") REFERENCES "public"."interpello"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possibile_duplicato" ADD CONSTRAINT "possibile_duplicato_interpello_b_interpello_id_fk" FOREIGN KEY ("interpello_b") REFERENCES "public"."interpello"("id") ON DELETE cascade ON UPDATE no action;