CREATE TABLE "documento_parte" (
	"archivio" text NOT NULL,
	"posizione" integer NOT NULL,
	"nome" text NOT NULL,
	"parte" text NOT NULL,
	CONSTRAINT "documento_parte_archivio_posizione_pk" PRIMARY KEY("archivio","posizione")
);
--> statement-breakpoint
ALTER TABLE "interpello" ADD COLUMN "documento_non_leggibile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_parte" ADD CONSTRAINT "documento_parte_archivio_documento_hash_fk" FOREIGN KEY ("archivio") REFERENCES "public"."documento"("hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_parte" ADD CONSTRAINT "documento_parte_parte_documento_hash_fk" FOREIGN KEY ("parte") REFERENCES "public"."documento"("hash") ON DELETE no action ON UPDATE no action;