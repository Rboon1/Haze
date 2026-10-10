PORT ?= 4173
URL  := http://127.0.0.1:$(PORT)/

.PHONY: run

# Serve the scene locally and open it in the default browser.
run:
	@echo "KLCC Park Walk -> $(URL)  (Ctrl+C to stop)"
	@(sleep 1 && open "$(URL)") >/dev/null 2>&1 &
	@python3 -m http.server $(PORT) --bind 127.0.0.1
