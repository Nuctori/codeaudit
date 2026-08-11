// InitDeity Unity 组件链（隐式 this + 全局静态 + 生命周期）
using UnityEngine;

public sealed class UnityComponents : MonoBehaviour
{
    public GameObject prefab;

    void Start()
    {
        gameObject.SetActive(true);
        transform.position = Vector3.zero;
        var clone = Instantiate(prefab);
        if (clone != null)
        {
            Destroy(clone, 2f);
        }
        StartCoroutine("Tick");
    }

    System.Collections.IEnumerator Tick()
    {
        yield return new WaitForSeconds(1f);
    }

    public Vector3 ReadPosition()
    {
        return transform.position;
    }
}
