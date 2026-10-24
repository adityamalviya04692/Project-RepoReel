from pipeline.classify import english, keep, repo_signal

# Synthetic captions shaped like the reels discovery returns.
EN = [
    "Free GitHub repo of the week: an open-source video editor that auto-captions your clips and exports for every platform.",
    "Comment API and I'll send you the link. You can now run this coding agent for free with almost unlimited usage.",
    "This might be one of the coolest open-source projects I've found recently. It gives your AI agent its own computer.",
]
NOT_EN = [
    "Este repo de GitHub es increíble para la búsqueda de empleo con IA, ¿real o hype? Lo probé en mi laboratorio",
    "Lagi rame di GitHub repo namanya REA, tool MCP yang bikin Claude Code jadi lebih pintar, tapi ingat ini gratis",
    "Growth hacking aur Reddit marketing automate karne ke liye puri AI agency hi open-source ho chuki hai",
    "самые звёздные репозитории на GitHub – это просто списки, и они лучше многих программ",
    "GitHub 上爆紅的四個 AI agent 工具！讓開發效率直接起飛的熱門 AI 工具",
    "Durch dieses Tool ist alles einfach nächstes Level und die Automatisierung ist nicht schwer #github",
    "",
    "🔥🔥🔥 #github #opensource",
]


def test_english_captions():
    assert all(english(t) for t in EN)
    assert not any(english(t) for t in NOT_EN)


def test_repo_signal_separates_repos_from_general_ai():
    assert repo_signal("Check github.com/acme/widget for the code")
    assert repo_signal("acme/widget is the fastest way to parse PDFs")
    assert repo_signal("Someone just open-sourced a tool that clones any website") and repo_signal("Comment HUMAN for the setup #githubrepo")
    assert not repo_signal("Tom Brady is the greatest quarterback in NFL history, here is his routine")
    assert not repo_signal("Connect your calendar, Gmail and Slack so your AI assistant reads them for you")
    assert not repo_signal("Visit example.com/pricing for details")


def test_keep_needs_both_and_ocr_can_supply_the_repo_signal():
    caption = "Comment TOOL and I'll send it to you. This app turns any screenshot into working code in seconds."
    assert not keep({"caption": caption})
    assert keep({"caption": caption, "ocr": "github.com/acme/shot2code"})
    assert not keep({"caption": NOT_EN[0]})
