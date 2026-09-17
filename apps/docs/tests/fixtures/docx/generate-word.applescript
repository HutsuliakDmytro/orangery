(*
  Generates the `real/` half of the DOCX corpus by driving Microsoft Word.

  Synthetic fixtures prove the parser handles constructs; only a file Word wrote
  proves preservation, because only Word produces a real styles.xml, theme1.xml,
  settings.xml and fontTable.xml. See tests/fixtures/docx/README.md.

  Creates new documents only — it never opens or modifies anything the user has.

  Run:  osascript tests/fixtures/docx/generate-word.applescript <absolute-output-dir>
*)

on run argv
	set outputDir to item 1 of argv

	tell application "Microsoft Word"
		set wasRunning to true

		-- 1. A plain report with headings and body text.
		set d to make new document
		tell d
			set c to text object
			set content of c to "Quarterly Report" & return & ¬
				"Prepared for the review committee." & return & ¬
				"Summary" & return & ¬
				"The quick brown fox jumps over the lazy dog. Portez ce vieux whisky au juge blond qui fume." & return & ¬
				"Background" & return & ¬
				"Чуєш їх, доцю, га? Кумедна ж ти, прощайся без ґольфів." & return & ¬
				"Conclusion" & return & ¬
				"Findings are consistent with the previous period."

			set style of paragraph 1 of c to "Title"
			set style of paragraph 2 of c to "Subtitle"
			set style of paragraph 3 of c to "Heading 1"
			set style of paragraph 5 of c to "Heading 1"
			set style of paragraph 7 of c to "Heading 1"
		end tell
		save as d file name (outputDir & "/word-report.docx") file format format document
		close d saving no

		-- 2. Character formatting applied by Word itself.
		set d to make new document
		tell d
			set c to text object
			set content of c to "Bold italic underlined struck through coloured sized." & return & ¬
				"A second paragraph, justified, with a wider line spacing."
			set bold of font object of (characters 1 thru 4 of c) to true
			set italic of font object of (characters 6 thru 11 of c) to true
			set underline of font object of (characters 13 thru 22 of c) to word underline single
			set strike through of font object of (characters 24 thru 38 of c) to true
			set color index of font object of (characters 40 thru 47 of c) to red
			set font size of font object of (characters 49 thru 53 of c) to 18
		end tell
		save as d file name (outputDir & "/word-character-formatting.docx") file format format document
		close d saving no

		-- 3. Lists, which bring in numbering.xml.
		set d to make new document
		tell d
			set c to text object
			set content of c to "First bullet" & return & "Second bullet" & return & ¬
				"Third bullet" & return & "One" & return & "Two" & return & "Three"
			-- Applying the built-in list styles is enough to make Word write a real
			-- numbering.xml, and avoids the fragile `apply list format` API.
			set style of paragraph 1 of c to "List Bullet"
			set style of paragraph 2 of c to "List Bullet"
			set style of paragraph 3 of c to "List Bullet"
			set style of paragraph 4 of c to "List Number"
			set style of paragraph 5 of c to "List Number"
			set style of paragraph 6 of c to "List Number"
		end tell
		save as d file name (outputDir & "/word-lists.docx") file format format document
		close d saving no

		-- 4. A table, which brings in table styles and grid definitions.
		set d to make new document
		tell d
			set c to text object
			set content of c to "A table follows." & return & return
			set t to make new table at end of text object with properties {number of rows:4, number of columns:3}
			set content of text object of cell 1 of row 1 of t to "Header A"
			set content of text object of cell 2 of row 1 of t to "Header B"
			set content of text object of cell 3 of row 1 of t to "Header C"
			set content of text object of cell 1 of row 2 of t to "r2c1"
			set content of text object of cell 2 of row 2 of t to "r2c2"
			set content of text object of cell 3 of row 2 of t to "r2c3"
		end tell
		save as d file name (outputDir & "/word-table.docx") file format format document
		close d saving no

		-- Headers and footers are deliberately absent: Word's AppleScript
		-- dictionary refuses access to them ("Доступ заборонений", -1723), so a
		-- header fixture has to come from a document saved by hand. The checklist
		-- in README.md still lists it.

		-- 5. Page setup: A4, landscape, narrow margins.
		set d to make new document
		tell d
			set content of text object to "This page is A4 landscape with narrow margins."
			set ps to page setup of section 1
			set orientation of ps to landscape
			set top margin of ps to 36
			set bottom margin of ps to 36
			set left margin of ps to 36
			set right margin of ps to 36
		end tell
		save as d file name (outputDir & "/word-page-setup.docx") file format format document
		close d saving no
	end tell

	return "done"
end run
