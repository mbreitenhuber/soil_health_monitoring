async function deleteAnalysis(id) {

  if (!confirm("Delete this analysis?")) return;

  try {

    const res = await fetch(`${API_URL}/api/analyses/${id}`, {
      method: "DELETE"
    });

    if (!res.ok) {
      throw new Error("Delete failed");
    }

    location.reload();

  } catch (err) {

    console.error(err);

    alert("Could not delete analysis");
  }
}

document.addEventListener("DOMContentLoaded", () => {

  document.querySelectorAll(".delete-btn").forEach(btn => {

    btn.addEventListener("click", () => {

      const id = btn.dataset.id;

      deleteAnalysis(id);

    });

  });

});