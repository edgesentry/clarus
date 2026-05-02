using UnityEngine;

/// Visualises a rectangular restricted zone in the scene using a LineRenderer.
///
/// Place on an empty GameObject. Set corners to match the zone polygon in
/// sg-maritime-security/rules.json:
///   [[300,200],[600,200],[600,500],[300,500]]
///
/// In Unity coordinates (x = world x, z = world y):
///   (300, 0, 200) → (600, 0, 200) → (600, 0, 500) → (300, 0, 500) → back
///
/// The zone turns red when an alert is active. Wire up OnAlert() via your
/// alert UI script, or leave it static red for the demo recording.
public class ZoneBoundary : MonoBehaviour
{
    [Header("Zone corners (world metres: x=east, z=north)")]
    public float xMin = 300f;
    public float xMax = 600f;
    public float zMin = 200f;
    public float zMax = 500f;

    [Header("Appearance")]
    public Color normalColor = new Color(1f, 0.3f, 0.3f, 0.6f);
    public Color alertColor  = new Color(1f, 0f,   0f,   1.0f);
    public float lineWidth   = 2f;

    [Header("Label")]
    public bool showLabel = true;

    private LineRenderer _lr;
    private bool _alertActive = false;

    void Awake()
    {
        _lr = gameObject.AddComponent<LineRenderer>();
        _lr.loop = true;
        _lr.positionCount = 4;
        _lr.startWidth = lineWidth;
        _lr.endWidth   = lineWidth;
        _lr.useWorldSpace = true;

        // Use an unlit material — try URP first, fall back to Built-in
        var shader = Shader.Find("Universal Render Pipeline/Unlit")
                  ?? Shader.Find("Sprites/Default")
                  ?? Shader.Find("Unlit/Color");
        _lr.material = new Material(shader);
        SetColor(normalColor);
        UpdateCorners();
    }

    void UpdateCorners()
    {
        float y = 0.05f; // slightly above ground to avoid z-fighting
        _lr.SetPosition(0, new Vector3(xMin, y, zMin));
        _lr.SetPosition(1, new Vector3(xMax, y, zMin));
        _lr.SetPosition(2, new Vector3(xMax, y, zMax));
        _lr.SetPosition(3, new Vector3(xMin, y, zMax));
    }

    void SetColor(Color c)
    {
        _lr.startColor = c;
        _lr.endColor   = c;
    }

    /// Call from alert handler to flash the zone red.
    public void OnAlert(bool active)
    {
        _alertActive = active;
        SetColor(active ? alertColor : normalColor);
    }

    void OnGUI()
    {
        if (!showLabel) return;
        // World-to-screen label at zone centre
        Vector3 centre = new Vector3((xMin + xMax) / 2f, 0f, (zMin + zMax) / 2f);
        Vector3 screen = Camera.main != null ? Camera.main.WorldToScreenPoint(centre) : Vector3.zero;
        if (screen.z > 0)
        {
            GUI.color = _alertActive ? Color.red : new Color(1f, 0.5f, 0.5f);
            GUI.Label(new Rect(screen.x - 80, Screen.height - screen.y - 10, 160, 20),
                      "RESTRICTED ZONE");
        }
    }
}
