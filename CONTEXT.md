# Interpellevole

Collects interpelli (schools' calls for substitute teachers) from the offices that publish them and emails each recipient a daily summary of the ones matching their classi di concorso and province.

Terms are Italian, as the app is; code uses the same words.

## Language

### Notices

**Interpello**:
One school's notice about a call for a substitute — the notice itself, independent of where it was published. Has a Tipo, a Personale and one or more Pubblicazioni.
_Avoid_: entry, item, announcement, post, avviso

**Tipo**:
What an Interpello announces: *interpello* (a new call), *annullamento*, *rettifica*, *riapertura* (extension or reopening) or *esito* (outcome).
_Avoid_: kind, type, category

**Personale**:
Who an Interpello is for: *docente*, *ATA/DSGA* or *altro* (PNRR experts, tutors…). Only *docente* reaches a Riepilogo.
_Avoid_: staff, role, profile

**Pubblicazione**:
One item on a Fonte: its URL, data di pubblicazione, raw heading and attached documents as that Fonte shows them. Usually announces one Interpello; a bundle announces several, one per attached notice. Where heading and document disagree, the document wins.
_Avoid_: posting, entry, item, post, listing

**Possibile duplicato**:
An Interpello that may be the same notice as another one but whose match is too weak to merge them; both are kept and each is marked as possibly the same as the other.
_Avoid_: possible duplicate, probable match, fuzzy duplicate

**Fonte**:
A configured place Pubblicazioni are read from (e.g. the USP Bari Decreti page, USP Bari's local posts). Says nothing about where its schools are.
_Avoid_: source, feed, site, scraper

### Teaching posts

**Classe di concorso**:
A teaching-post category identified by its normalised code (e.g. `A011`, `ADMM`); `A-11` and `A11` are spellings of `A011`. An Interpello has one or more.
_Avoid_: subject, materia, class, CdC

**Gruppo di classi**:
A named set of Classi di concorso defined in configuration (e.g. *Sostegno secondaria* = ADMM + ADSS), chosen as a unit in preferences and expanded when matching.
_Avoid_: subject group, category, bundle

### Places

**Provincia**:
An Italian province, identified by its two-letter code (BA, BR, BT…). The unit recipients filter on.
_Avoid_: area, territory, zone

**Comune**:
A town, from the ISTAT list; belongs to exactly one Provincia. An Interpello's Provincia is its school's Comune's Provincia.
_Avoid_: city, town, località

**Scuola**:
The school issuing an Interpello, identified by its codice meccanografico (e.g. `BAIC81200X`) when known, otherwise only by name and Comune. Gives the Interpello its Comune.
_Avoid_: institute, istituto, school

**Da verificare**:
An Interpello whose Classe di concorso or Provincia could not be determined, or whose document could not be read ("documento non leggibile"). Reaches a Destinatario when nothing known contradicts their Preferenze, marked with what is missing (e.g. "classe di concorso non specificata").
_Avoid_: unresolved, unknown, incomplete

### Recipients

**Destinatario**:
A person who receives a Riepilogo; has an email address and Preferenze.
_Avoid_: recipient, subscriber, user, iscritto

**Preferenze**:
The Classi di concorso and/or Gruppi di classi, and the Province, a Destinatario wants. An Interpello matches when one of its Classi and its Provincia are both wanted.
_Avoid_: filters, subscription, settings

**Riepilogo**:
The daily email to one Destinatario listing the matching Interpelli not yet sent to them; at most one per day, none when nothing matches. An Interpello is sent to a Destinatario at most once.
_Avoid_: digest, summary, newsletter, report

**Avviso**:
One line telling Destinatari that a Fonte has a problem (*errore*: it can't be read; *silenzio*: nothing new for 7 days; *formato*: its Pubblicazioni stopped yielding Classi) or is back. Shown in a box atop every Riepilogo while the problem lasts; on days without a Riepilogo, sent as an alert-only email when the problem starts, every 3 days while it lasts, and on recovery. Never an Interpello.
_Avoid_: alert, warning, notification
