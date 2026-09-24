CREATE TABLE "documento" (
	"hash" text PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"dimensione" integer NOT NULL,
	"testo" text,
	"regione_oggetto" text,
	"errore" text,
	"creato_il" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documento_pubblicazione" (
	"pubblicazione_id" integer NOT NULL,
	"url" text NOT NULL,
	"posizione" integer NOT NULL,
	"hash" text,
	"errore" text,
	"letto_il" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documento_pubblicazione_pubblicazione_id_url_pk" PRIMARY KEY("pubblicazione_id","url"),
	CONSTRAINT "documento_pubblicazione_esito_coerente" CHECK (("documento_pubblicazione"."hash" is null) = ("documento_pubblicazione"."errore" is not null))
);
--> statement-breakpoint
ALTER TABLE "interpello" ADD COLUMN "documento" text;--> statement-breakpoint
ALTER TABLE "interpello" ADD COLUMN "documento_non_letto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interpello" ADD COLUMN "discordanze" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documento_pubblicazione" ADD CONSTRAINT "documento_pubblicazione_pubblicazione_id_pubblicazione_id_fk" FOREIGN KEY ("pubblicazione_id") REFERENCES "public"."pubblicazione"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_pubblicazione" ADD CONSTRAINT "documento_pubblicazione_hash_documento_hash_fk" FOREIGN KEY ("hash") REFERENCES "public"."documento"("hash") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpello" ADD CONSTRAINT "interpello_documento_documento_hash_fk" FOREIGN KEY ("documento") REFERENCES "public"."documento"("hash") ON DELETE no action ON UPDATE no action;