using System;
using System.Collections;
using System.Net;
using System.Net.Sockets;
using System.Text;
using UnityEngine;

/// Broadcasts entity positions to a clarus UDP listener at a fixed tick rate.
///
/// Attach to any single GameObject in the scene (e.g. an empty "ClarusManager").
/// All GameObjects with a ClarusEntity component are discovered automatically.
///
/// Coordinate mapping:
///   Unity  (x, y, z)  →  clarus (x, y)
///   Unity's y-axis is vertical (up); clarus uses the horizontal plane only.
///   → Unity x → clarus x,  Unity z → clarus y,  Unity y discarded.
///
/// Packet format (matches UnityPacket in crates/input-adapter/src/unity_udp.rs):
/// {
///   "entities": [
///     {"id":"forklift_01","class":"Forklift","x":14.2,"y":31.7,
///      "vx":0.0,"vy":2.1,"timestamp_ms":1714209600123}
///   ]
/// }
public class ClarusUdpExporter : MonoBehaviour
{
    [Header("Network")]
    [Tooltip("IP address of the machine running clarus (127.0.0.1 for local)")]
    public string targetHost = "127.0.0.1";

    [Tooltip("UDP port that clarus is listening on")]
    public int targetPort = 9000;

    [Header("Tick rate")]
    [Tooltip("Packets sent per second (Unity simulation runs at this rate)")]
    public float tickHz = 10f;

    [Header("Debug")]
    public bool logPackets = false;

    private UdpClient _udpClient;
    private IPEndPoint _endpoint;

    void Start()
    {
        _udpClient = new UdpClient();
        _endpoint = new IPEndPoint(IPAddress.Parse(targetHost), targetPort);
        StartCoroutine(ExportLoop());
        Debug.Log($"[ClarusUdpExporter] Streaming to udp://{targetHost}:{targetPort} at {tickHz} Hz");
    }

    void OnDestroy()
    {
        StopAllCoroutines();
        _udpClient?.Close();
    }

    private IEnumerator ExportLoop()
    {
        var interval = new WaitForSeconds(1f / tickHz);
        while (true)
        {
            SendTick();
            yield return interval;
        }
    }

    private void SendTick()
    {
        var entities = FindObjectsByType<ClarusEntity>(FindObjectsInactive.Exclude);
        if (entities.Length == 0) return;

        long timestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        float dt = 1f / tickHz;

        var sb = new StringBuilder();
        sb.Append("{\"entities\":[");

        for (int i = 0; i < entities.Length; i++)
        {
            var e = entities[i];
            var pos = e.transform.position;

            // Derive velocity from position delta (Unity z → clarus y)
            float vx = (pos.x - e.previousPosition.x) / dt;
            float vy = (pos.z - e.previousPosition.z) / dt;
            e.previousPosition = pos;

            if (i > 0) sb.Append(",");
            sb.Append("{");
            sb.Append($"\"id\":\"{Escape(e.entityId)}\",");
            sb.Append($"\"class\":\"{e.entityClass}\",");
            sb.Append($"\"x\":{pos.x:F3},");
            sb.Append($"\"y\":{pos.z:F3},");     // Unity z → clarus y
            sb.Append($"\"vx\":{vx:F3},");
            sb.Append($"\"vy\":{vy:F3},");
            sb.Append($"\"timestamp_ms\":{timestampMs}");
            sb.Append("}");
        }

        sb.Append("]}");

        string json = sb.ToString();
        byte[] payload = Encoding.UTF8.GetBytes(json);

        try
        {
            _udpClient.Send(payload, payload.Length, _endpoint);
            if (logPackets) Debug.Log($"[ClarusUdpExporter] {json}");
        }
        catch (Exception ex)
        {
            Debug.LogWarning($"[ClarusUdpExporter] Send failed: {ex.Message}");
        }
    }

    // Minimal JSON string escape (handles the characters likely in entity IDs).
    private static string Escape(string s) =>
        s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
